// Shared helpers for the /propose-playlists scripts. They only read files and
// open the DB read-only, so they are safe to run while the server runs.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import type { Snapshot } from '@curator/shared';
import { DATA_DIR } from '../../../db/db.ts';

// Piping into `head` closes stdout early; that is not an error.
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0);
  throw e;
});

export const SNAPSHOT_PATH = resolve(DATA_DIR, 'snapshot.json');
export const PROPOSALS_PATH = resolve(DATA_DIR, 'proposals.json');
export const DB_PATH = resolve(DATA_DIR, 'curator.sqlite');

export function loadSnapshot(path = SNAPSHOT_PATH): Snapshot {
  if (!existsSync(path)) {
    console.error(`No Snapshot at ${path}.`);
    console.error('In the app (npm run dev, then http://127.0.0.1:5173): Setup & Sync → Sync, then Library → Enrich → Build snapshot.');
    process.exit(2);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

export function openDbReadOnly(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  try {
    return new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch {
    return null;
  }
}

/** Parses "--key value" and "--flag" arguments. */
export function parseArgs(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      args.set(a.slice(2), next);
      i++;
    } else args.set(a.slice(2), 'true');
  }
  return args;
}

export function parseRange(value: string | undefined): [number, number] | null {
  if (!value) return null;
  const [lo, hi] = value.split('-').map((x) => (x === '' ? NaN : Number(x)));
  return [Number.isFinite(lo) ? lo! : -Infinity, Number.isFinite(hi) ? hi! : Infinity];
}

export const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

export function countBy<T>(items: T[], key: (t: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const it of items) {
    const k = key(it);
    if (k != null) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()];
}

export const bar = (n: number, max: number, width = 30) => '#'.repeat(max > 0 ? Math.max(n > 0 ? 1 : 0, Math.round((n / max) * width)) : 0);

export function histogram(title: string, rows: [string, number][]) {
  const max = Math.max(0, ...rows.map((r) => r[1]));
  const pad = Math.max(...rows.map((r) => r[0].length), 4);
  console.log(`\n## ${title}`);
  for (const [k, n] of rows) console.log(`${k.padStart(pad)} ${String(n).padStart(5)} ${bar(n, max)}`);
}
