import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CLI_COMMANDS, detectAgents, runAgentCli, type ChildLike, type SpawnFn } from './agents.ts';

interface FakeCall {
  bin: string;
  args: string[];
  cwd: string;
  stdin: string;
  killed: string | null;
}

/** A fake child process: collects stdin, then answers via `behave`. */
function fakeSpawn(behave: (child: { stdout: PassThrough; stderr: PassThrough; close: (code: number) => void }, call: FakeCall) => void) {
  const calls: FakeCall[] = [];
  const spawn: SpawnFn = (bin, args, opts) => {
    const events = new EventEmitter();
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const call: FakeCall = { bin, args, cwd: opts.cwd, stdin: '', killed: null };
    calls.push(call);
    const close = (code: number) => setImmediate(() => events.emit('close', code, null));
    stdin.on('data', (b: Buffer) => (call.stdin += b.toString('utf8')));
    stdin.on('finish', () => behave({ stdout, stderr, close }, call));
    const child: ChildLike = {
      stdin,
      stdout,
      stderr,
      on: (event: string, fn: (...a: any[]) => void) => events.on(event, fn),
      kill: (signal) => {
        call.killed = signal ?? 'SIGTERM';
        return true;
      },
    };
    return child;
  };
  return { spawn, calls };
}

describe('CLI_COMMANDS', () => {
  it('claude: print mode, JSON envelope, no tools, no session', () => {
    const args = CLI_COMMANDS.claude.args('/x');
    expect(args).toEqual(expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']));
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2)).toEqual(['--tools', '']);
    expect(CLI_COMMANDS.claude.answerInFile).toBe(false);
  });

  it('codex: exec, read-only sandbox, ephemeral, last message to a file, prompt from stdin', () => {
    const args = CLI_COMMANDS.codex.args('/tmp/x/last.txt');
    expect(args[0]).toBe('exec');
    expect(args).toEqual(expect.arrayContaining(['--skip-git-repo-check', '--ephemeral']));
    expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'read-only']);
    expect(args.slice(args.indexOf('--output-last-message'), args.indexOf('--output-last-message') + 2)).toEqual(['--output-last-message', '/tmp/x/last.txt']);
    expect(args.at(-1)).toBe('-');
    expect(CLI_COMMANDS.codex.answerInFile).toBe(true);
  });

  it('gemini: headless prompt, JSON output, read-only plan mode, no extensions', () => {
    const args = CLI_COMMANDS.gemini.args('/x');
    expect(args).toContain('--prompt');
    expect(args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(args.slice(args.indexOf('--approval-mode'), args.indexOf('--approval-mode') + 2)).toEqual(['--approval-mode', 'plan']);
    expect(args.slice(args.indexOf('--extensions'), args.indexOf('--extensions') + 2)).toEqual(['--extensions', 'none']);
  });
});

describe('detectAgents', () => {
  const has = (names: string[]) => (n: string) => names.includes(n);

  it('lists CLIs on PATH in preference order and selects the first', () => {
    expect(detectAgents({}, has(['gemini', 'codex', 'claude']))).toEqual({ available: ['claude', 'codex', 'gemini'], selected: 'claude' });
    expect(detectAgents({}, has(['gemini', 'codex']))).toEqual({ available: ['codex', 'gemini'], selected: 'codex' });
    expect(detectAgents({}, has([]))).toEqual({ available: [], selected: null });
  });

  it('AGENT_CLI wins when it is installed', () => {
    expect(detectAgents({ AGENT_CLI: 'Codex' }, has(['claude', 'codex'])).selected).toBe('codex');
    expect(detectAgents({ AGENT_CLI: 'gemini' }, has(['claude', 'codex'])).selected).toBe('claude');
    expect(detectAgents({ AGENT_CLI: 'nonsense' }, has(['codex'])).selected).toBe('codex');
  });
});

describe('runAgentCli', () => {
  it('sends the prompt on stdin, runs in a fresh temp folder and returns stdout', async () => {
    const { spawn, calls } = fakeSpawn(({ stdout, close }, call) => {
      stdout.end(`answer to: ${call.stdin}`);
      close(0);
    });
    const out = await runAgentCli('claude', 'hello', { spawn });
    expect(out).toBe('answer to: hello');
    const call = calls[0]!;
    expect(call.bin).toBe('claude');
    expect(call.cwd.startsWith(tmpdir())).toBe(true);
    expect(call.cwd).not.toContain(process.cwd());
    expect(existsSync(call.cwd)).toBe(false); // removed afterwards
  });

  it('reads the last-message file for codex', async () => {
    const { spawn, calls } = fakeSpawn(async ({ stdout, close }, call) => {
      const file = call.args[call.args.indexOf('--output-last-message') + 1]!;
      expect(file.startsWith(call.cwd)).toBe(true);
      await writeFile(file, '{"transitions": []}');
      stdout.end('progress noise');
      close(0);
    });
    expect(await runAgentCli('codex', 'p', { spawn })).toBe('{"transitions": []}');
    expect(calls[0]!.stdin).toBe('p');
  });

  it('fails with the trimmed stderr on a non-zero exit', async () => {
    const { spawn } = fakeSpawn(({ stderr, close }) => {
      stderr.end('  Not logged in. Run claude login.\n\n');
      close(1);
    });
    await expect(runAgentCli('claude', 'p', { spawn })).rejects.toThrow('Claude Code stopped with exit code 1: Not logged in. Run claude login.');
  });

  it('kills the CLI on timeout', async () => {
    const { spawn, calls } = fakeSpawn(() => {});
    await expect(runAgentCli('gemini', 'p', { spawn, timeoutMs: 20 })).rejects.toThrow(/Gemini CLI did not answer within/);
    expect(calls[0]!.killed).toBe('SIGKILL');
  });

  it('kills the CLI when the job is stopped', async () => {
    const { spawn, calls } = fakeSpawn(() => {});
    const controller = new AbortController();
    const run = runAgentCli('claude', 'p', { spawn, signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    await expect(run).rejects.toThrow('Stopped.');
    expect(calls[0]!.killed).toBe('SIGKILL');
  });
});
