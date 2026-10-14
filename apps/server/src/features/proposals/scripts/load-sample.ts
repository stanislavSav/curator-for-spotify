// For UI work without a real Library: copies the sample Proposals to
// data/proposals.json and adds the sample tracks to the DB `tracks` table
// (not to Liked Songs or playlists, so other pages do not show them).
// Usage: npx tsx apps/server/src/features/proposals/scripts/load-sample.ts [--force]
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from '../../../db/db.ts';
import { SAMPLE_PROPOSALS, seedSampleLibrary } from '../fixtures/seed.ts';
import { PROPOSALS_PATH } from './common.ts';

if (existsSync(PROPOSALS_PATH) && !process.argv.includes('--force')) {
  console.error(`${PROPOSALS_PATH} already exists. Add --force to replace it.`);
  process.exit(1);
}
const tracks = seedSampleLibrary(getDb());
copyFileSync(fileURLToPath(SAMPLE_PROPOSALS), PROPOSALS_PATH);
console.log(`Wrote ${PROPOSALS_PATH} and ${tracks.length} sample tracks. Open http://127.0.0.1:5173/#/proposals.`);
console.log('Do not create these on Spotify: the track ids are fake.');
