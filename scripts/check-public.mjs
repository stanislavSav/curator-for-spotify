#!/usr/bin/env node
// Privacy guard. Fails when a file that git would publish holds private data:
// your library (data/, DB, Snapshot, Proposals, backups), .env, keys, secrets,
// or a personal marker from the local, git-ignored file .private-markers.
//
// Usage:
//   node scripts/check-public.mjs            all files git would publish (tracked + untracked, not ignored)
//   node scripts/check-public.mjs --staged   only the staged changes (used by .githooks/pre-commit)
//   node scripts/check-public.mjs --markers <file>   use another markers file
//
// Skip one line on purpose: add the text "check-public-ignore" to that line.
// Exit codes: 0 clean, 1 findings, 2 cannot run (for example, not a git repo).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkPath, isBinary, parseMarkers, scanText } from './lib/check-public-rules.mjs';

const args = process.argv.slice(2);
const staged = args.includes('--staged');
const markersArg = args.indexOf('--markers');

function git(gitArgs, input) {
  return execFileSync('git', gitArgs, { maxBuffer: 1 << 30, input, stdio: ['pipe', 'pipe', 'pipe'] });
}

function splitZ(buf) {
  return buf.toString('utf8').split('\0').filter(Boolean);
}

let root;
try {
  root = git(['rev-parse', '--show-toplevel']).toString().trim();
} catch {
  console.error('check-public: this is not a git repository (or git is not installed). Nothing was checked.');
  process.exit(2);
}

const markersFile = markersArg >= 0 ? args[markersArg + 1] : join(root, '.private-markers');
const markers = markersFile && existsSync(markersFile) ? parseMarkers(readFileSync(markersFile, 'utf8')) : [];

/** Returns [{ path, read: () => Buffer | null }]. */
function listFiles() {
  if (!staged) {
    const paths = splitZ(git(['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z']));
    return [...new Set(paths)].map((path) => ({
      path,
      read: () => {
        const abs = join(root, path);
        return existsSync(abs) ? readFileSync(abs) : null;
      },
    }));
  }
  // Staged mode: read the blobs from the index, not from the working tree.
  const changed = new Set(splitZ(git(['-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])));
  if (changed.size === 0) return [];
  const blobs = new Map();
  for (const entry of splitZ(git(['-C', root, 'ls-files', '--stage', '-z']))) {
    const [meta, path] = entry.split('\t');
    const [mode, oid] = meta.split(' ');
    if (changed.has(path) && mode !== '160000') blobs.set(path, oid);
  }
  const contents = readBlobs([...blobs.values()]);
  return [...blobs].map(([path, oid]) => ({ path, read: () => contents.get(oid) ?? null }));
}

/** Reads many blobs with one `git cat-file --batch` call. */
function readBlobs(oids) {
  const out = new Map();
  if (oids.length === 0) return out;
  const buf = git(['-C', root, 'cat-file', '--batch'], oids.join('\n') + '\n');
  let pos = 0;
  while (pos < buf.length) {
    const nl = buf.indexOf(10, pos);
    const [oid, type, size] = buf.subarray(pos, nl).toString().split(' ');
    if (type === 'missing') {
      pos = nl + 1;
      continue;
    }
    const len = Number(size);
    out.set(oid, buf.subarray(nl + 1, nl + 1 + len));
    pos = nl + 1 + len + 1;
  }
  return out;
}

const problems = [];
const files = listFiles();
for (const { path, read } of files) {
  const pathReason = checkPath(path);
  if (pathReason) problems.push(`${path}: ${pathReason}`);
  const buf = read();
  if (!buf || isBinary(buf)) continue;
  for (const f of scanText(buf.toString('utf8'), markers)) {
    problems.push(`${path}:${f.line}: ${f.reason} [${f.detail}]`);
  }
}

const scope = staged ? 'staged file(s)' : 'publishable file(s)';
const markerNote = markers.length ? `, ${markers.length} personal marker(s)` : ', no .private-markers file';
if (problems.length === 0) {
  console.log(`check-public: OK (${files.length} ${scope}${markerNote}).`);
  process.exit(0);
}

console.error(`check-public: found ${problems.length} problem(s) in ${files.length} ${scope}${markerNote}:\n`);
for (const p of problems) console.error(`  ${p}`);
console.error(`
Fix: remove the data, move the file out of the repo, or add it to .gitignore.
If a match is intentional, add the text "check-public-ignore" to that line.
See CONTRIBUTING.md › Privacy guard.`);
process.exit(1);
