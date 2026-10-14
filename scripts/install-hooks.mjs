#!/usr/bin/env node
// Runs on `npm install` (the "prepare" script).
// Points git at .githooks/ so the pre-commit privacy guard runs.
// It never fails the install: in CI, outside a git repo, or when you already
// use another hooks folder, it does nothing.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOKS = '.githooks';

function git(args) {
  return execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim();
}

function main() {
  if (process.env.CI) return;
  if (!existsSync(join(root, '.git'))) return;
  let current = '';
  try {
    current = git(['config', '--get', 'core.hooksPath']);
  } catch {
    // Exit code 1: the key is not set.
  }
  if (current === HOOKS) return;
  if (current) {
    console.log(`install-hooks: core.hooksPath is already "${current}". Left as is.`);
    console.log(`install-hooks: to use the privacy guard, run: git config core.hooksPath ${HOOKS}`);
    return;
  }
  git(['config', 'core.hooksPath', HOOKS]);
  console.log('install-hooks: git hooks enabled (.githooks/pre-commit runs the privacy guard).');
}

try {
  main();
} catch {
  // Never break `npm install` because of hooks.
}
