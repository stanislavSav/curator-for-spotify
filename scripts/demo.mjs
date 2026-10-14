#!/usr/bin/env node
// `npm run demo`: try the app without a Spotify app. It runs the same two
// processes as `npm run dev`, with a fake Library in data/demo/ and every
// Spotify call blocked (CURATOR_DEMO=1, see apps/server/src/demo/).
//
//   npm run demo                         seed data/demo/ if needed, then start
//   npm run demo -- --reset              throw away data/demo/ and seed it again
//   PORT=8797 WEB_PORT=5183 npm run demo run next to `npm run dev`
//
// The server seeds data/demo/ when it is missing (or older than 30 days).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'demo');
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run demo [-- --reset]\nEnv: PORT (API server, default 8787), WEB_PORT (web app, default 5173).');
  process.exit(0);
}

const port = process.env.PORT || '8787';
const webPort = process.env.WEB_PORT || '5173';

function portFree(p) {
  return new Promise((done) => {
    const server = createServer()
      .once('error', () => done(false))
      .once('listening', () => server.close(() => done(true)));
    server.listen(Number(p), '127.0.0.1');
  });
}

// npm_execpath is set when this runs through `npm run`; it avoids the npm.cmd
// shim (and its shell) on Windows.
function npmCommand(npmArgs) {
  const cli = process.env.npm_execpath;
  if (cli && /npm-cli\.c?js$/.test(cli)) return { cmd: process.execPath, args: [cli, ...npmArgs], shell: false };
  return { cmd: 'npm', args: npmArgs, shell: process.platform === 'win32' };
}

const children = [];
let stopping = false;

function run(name, color, workspace, env) {
  const { cmd, args: cmdArgs, shell } = npmCommand(['run', 'dev', '-w', workspace]);
  const child = spawn(cmd, cmdArgs, {
    cwd: root,
    env,
    shell,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group on POSIX, so stop() can end npm and everything it started.
    detached: process.platform !== 'win32',
  });
  const prefix = process.stdout.isTTY ? `\x1b[${color}m[${name}]\x1b[0m ` : `[${name}] `;
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      if (stopping) return; // npm reports the stop as an error; that is noise
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) out.write(`${prefix}${line}\n`);
    });
    stream.on('end', () => rest && !stopping && out.write(`${prefix}${rest}\n`));
  }
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.log(`[demo] ${name} stopped (${signal ?? `exit code ${code}`}). Stopping the demo.`);
      stop(code ?? 1);
    }
  });
  children.push(child);
}

function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(kill);
  // Give the processes a moment to exit cleanly, then leave.
  setTimeout(() => process.exit(code), 500).unref();
  Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(
    () => process.exit(code),
  );
}

async function main() {
  for (const [name, p] of [
    ['PORT', port],
    ['WEB_PORT', webPort],
  ]) {
    if (!(await portFree(p))) {
      console.error(
        `[demo] Port ${p} is in use (is \`npm run dev\` running?). Pick free ports, for example:\n` +
          '       PORT=8797 WEB_PORT=5183 npm run demo\n' +
          `       (Windows PowerShell: $env:PORT=8797; $env:WEB_PORT=5183; npm run demo) — ${name} was ${p}.`,
      );
      process.exit(1);
    }
  }

  if (args.includes('--reset') && existsSync(dataDir)) {
    rmSync(dataDir, { recursive: true, force: true });
    console.log('[demo] Removed data/demo/. The server seeds it again.');
  } else if (!existsSync(dataDir)) {
    console.log('[demo] No data/demo/ yet. The server seeds a fake Library on start.');
  }

  const env = {
    ...process.env,
    CURATOR_DEMO: '1',
    CURATOR_DATA_DIR: dataDir,
    PORT: port,
    WEB_PORT: webPort,
    ...(process.stdout.isTTY ? { FORCE_COLOR: '1' } : {}),
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  process.on('SIGHUP', () => stop(0));

  run('server', '32', '@curator/server', env);
  run('web', '36', '@curator/web', env);
  console.log(`[demo] Demo mode. Open http://127.0.0.1:${webPort} — press Ctrl+C to stop.`);
}

main();
