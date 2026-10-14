import { spawn as nodeSpawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { AgentCli, AiPassAgents } from '@curator/shared';
import { AGENT_CLIS } from '../schema.ts';

// Runs the user's own agent CLI headless (ADR 0004): prompt on stdin, no
// tools, no saved session, in a fresh empty temp folder, JSON read back.

export const AGENT_LABEL: Record<AgentCli, string> = { claude: 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' };

interface CliCommand {
  bin: string;
  /** `lastMessage` is a file in the temp folder for CLIs that write their answer there. */
  args: (lastMessage: string) => string[];
  /** Read the answer from the lastMessage file instead of stdout. */
  answerInFile: boolean;
}

/**
 * Headless flags per CLI, checked against claude 2.1, codex-cli 0.156 and the
 * Gemini CLI reference (2026-10). No model flag: each CLI uses the user's default.
 */
export const CLI_COMMANDS: Record<AgentCli, CliCommand> = {
  claude: {
    bin: 'claude',
    args: () => [
      '-p', //                          print mode: read the prompt from stdin, answer, exit
      '--output-format', 'json', //     one JSON envelope; the answer text is in `result`
      '--tools', '', //                 no built-in tools at all
      '--no-session-persistence', //    do not save the session to disk
      '--strict-mcp-config', //         ignore the user's MCP servers (none given)
      '--disable-slash-commands', //    no skills
    ],
    answerInFile: false,
  },
  codex: {
    bin: 'codex',
    args: (lastMessage) => [
      'exec', //                        non-interactive run
      '--sandbox', 'read-only', //      Codex cannot turn tools off; it may only read the empty folder
      '--skip-git-repo-check', //       the temp folder is not a git repo
      '--ephemeral', //                 do not persist session files
      '--color', 'never', //            plain output
      '--output-last-message', lastMessage, // the final answer goes to this file
      '-', //                           read the prompt from stdin
    ],
    answerInFile: true,
  },
  gemini: {
    bin: 'gemini',
    args: () => [
      '--prompt', 'Answer the request above with the JSON only.', // headless; appended to stdin
      '--output-format', 'json', //     one JSON object; the answer text is in `response`
      '--approval-mode', 'plan', //     read-only: no edits, no shell
      '--extensions', 'none', //        no extensions
      '--skip-trust', //                the empty temp folder needs no trust prompt
    ],
    answerInFile: false,
  },
};

/** True when an executable with this name is on PATH. */
export function onPath(name: string, path = process.env.PATH ?? ''): boolean {
  const exts = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  return path
    .split(delimiter)
    .filter(Boolean)
    .some((dir) =>
      exts.some((ext) => {
        try {
          accessSync(join(dir, name + ext), constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
    );
}

/** CLIs on PATH in preference order; AGENT_CLI wins when it is one of them. */
export function detectAgents(env: NodeJS.ProcessEnv = process.env, has: (name: string) => boolean = (n) => onPath(n, env.PATH)): AiPassAgents {
  const available = AGENT_CLIS.filter((cli) => has(CLI_COMMANDS[cli].bin));
  const wanted = env.AGENT_CLI?.trim().toLowerCase() as AgentCli | undefined;
  const selected = wanted && available.includes(wanted) ? wanted : (available[0] ?? null);
  return { available, selected };
}

/** The part of node's ChildProcess the runner uses, so tests can fake it. */
export interface ChildLike {
  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;
  on(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
}
export type SpawnFn = (bin: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildLike;

export interface RunOptions {
  spawn?: SpawnFn;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export const AI_PASS_TIMEOUT_MS = 4 * 60_000;

const defaultSpawn: SpawnFn = (bin, args, opts) =>
  nodeSpawn(bin, args, { ...opts, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });

/** Runs one CLI with the prompt on stdin and returns its answer text (stdout or the last-message file). */
export async function runAgentCli(cli: AgentCli, prompt: string, opts: RunOptions = {}): Promise<string> {
  const { spawn = defaultSpawn, timeoutMs = AI_PASS_TIMEOUT_MS, env = process.env } = opts;
  const cmd = CLI_COMMANDS[cli];
  const dir = await mkdtemp(join(tmpdir(), 'curator-ai-pass-'));
  const lastMessage = join(dir, 'last-message.txt');
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(cmd.bin, cmd.args(lastMessage), { cwd: dir, env });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let done = false;
      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
        fn();
      };
      const stop = (message: string) => {
        child.kill('SIGKILL');
        finish(() => reject(new Error(message)));
      };
      const timer = setTimeout(() => stop(`${AGENT_LABEL[cli]} did not answer within ${Math.round(timeoutMs / 60_000)} minutes.`), timeoutMs);
      const onAbort = () => stop('Stopped.');
      opts.signal?.addEventListener('abort', onAbort);
      child.stdout?.on('data', (b: Buffer) => out.push(b));
      child.stderr?.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e) => finish(() => reject(new Error(`Could not start ${AGENT_LABEL[cli]}: ${e.message}`))));
      child.on('close', (code) =>
        finish(() => {
          const stderr = Buffer.concat(err).toString('utf8').trim();
          if (code === 0) resolve(Buffer.concat(out).toString('utf8'));
          else reject(new Error(`${AGENT_LABEL[cli]} stopped with exit code ${code}${stderr ? `: ${stderr.slice(-400)}` : '.'}`));
        }),
      );
      child.stdin?.on('error', () => {}); // the CLI may exit before reading all of stdin
      child.stdin?.end(prompt);
    });
    if (!cmd.answerInFile) return stdout;
    return await readFile(lastMessage, 'utf8').catch(() => stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
