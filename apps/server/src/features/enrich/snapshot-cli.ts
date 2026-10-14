// `npm run snapshot` — writes data/snapshot.json from the local DB and prints a summary.
import { relative } from 'node:path';
import { getDb, ROOT_DIR } from '../../db/db.ts';
import { buildSnapshot, SNAPSHOT_FILE, snapshotSummary, writeSnapshot } from './snapshot.ts';

const snapshot = buildSnapshot(getDb());
if (snapshot.tracks.length === 0) {
  console.error('The Library is empty. Connect and run Sync in the app first.');
  process.exit(1);
}
const bytes = writeSnapshot(snapshot);
console.log(snapshotSummary(snapshot, bytes));
console.log(`Top tags: ${snapshot.tagCounts.slice(0, 12).map(([t, n]) => `${t} (${n})`).join(', ') || 'none yet'}`);
console.log(`Written to ${relative(ROOT_DIR, SNAPSHOT_FILE)}. Next: ask your AI agent to propose playlists.`);
