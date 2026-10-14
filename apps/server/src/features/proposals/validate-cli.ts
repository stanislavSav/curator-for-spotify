// `npm run validate-proposals [-- path/to/proposals.json]`
// Checks data/proposals.json against the schema and the local DB. Exit code 1 on errors.
import { resolve } from 'node:path';
import type { ValidationIssue } from '@curator/shared';
import { getDb } from '../../db/db.ts';
import { defaultPaths, knownTrackIds, loadProposals } from './service.ts';

const arg = process.argv[2];
const paths = { ...defaultPaths(), ...(arg ? { proposals: resolve(process.env.INIT_CWD ?? process.cwd(), arg) } : {}) };
const db = getDb();

const line = (i: ValidationIssue) => `  - ${i.path ? `${i.path}: ` : ''}${i.message}`;

console.log(`Checking ${paths.proposals}`);
const trackCount = knownTrackIds(db).size;
if (trackCount === 0) console.log('Note: the local DB has no tracks. Run Sync first, or every track id will be unknown.');

const loaded = loadProposals(db, paths);
if (loaded.status === 'missing') {
  console.error('No proposals file. Run /propose-playlists with your AI agent, or press "Generate basic proposals" on the Proposals page.');
  process.exit(1);
}

const v = loaded.validation!;
const file = v.file;
if (file) {
  console.log(`${file.proposals.length} proposals, generated ${file.generatedAt}, from Snapshot ${file.snapshotGeneratedAt}.`);
  for (const p of file.proposals) {
    const errs = v.errors.filter((e) => e.proposalId === p.id).length;
    const warns = v.warnings.filter((e) => e.proposalId === p.id).length;
    const mark = errs ? 'ERR ' : warns ? 'warn' : ' ok ';
    console.log(`  [${mark}] ${p.id} — "${p.name}" (${p.tracks.length} tracks, ${p.theme})`);
  }
}

if (v.warnings.length) {
  console.log(`\n${v.warnings.length} warning(s):`);
  for (const w of v.warnings) console.log(line(w));
}
if (v.errors.length) {
  console.error(`\n${v.errors.length} error(s):`);
  for (const e of v.errors.slice(0, 200)) console.error(line(e));
  if (v.errors.length > 200) console.error(`  … and ${v.errors.length - 200} more`);
  process.exit(1);
}
console.log('\nOK: the file is valid. Open http://127.0.0.1:5173/#/proposals to review it.');
