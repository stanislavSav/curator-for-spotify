import { serve } from '@hono/node-server';
import { app } from './app.ts';
import { config } from './config.ts';
import { DATA_DIR } from './db/db.ts';
import { withDemoMode } from './demo/guard.ts';
import { ensureDemoData } from './demo/seed.ts';
import { failStaleJobs } from './jobs/jobs.ts';

if (config.demo) {
  const seeded = ensureDemoData(DATA_DIR);
  if (seeded) console.log(`Demo Library seeded in ${DATA_DIR}: ${seeded.tracks} tracks, ${seeded.historyRows} plays.`);
}
failStaleJobs();
serve({ fetch: withDemoMode(app.fetch), hostname: '127.0.0.1', port: config.port }, (info) => {
  console.log(`curator server on http://127.0.0.1:${info.port}${config.demo ? ' (demo mode: fake Library, no Spotify calls)' : ''}`);
  if (!config.clientId && !config.demo) console.warn('SPOTIFY_CLIENT_ID is not set. See SETUP.md.');
});
