import { Hono } from 'hono';
import { getDb } from '../../db/db.ts';
import { startJob } from '../../jobs/jobs.ts';
import { NotConnectedError, readAuth } from '../../spotify/auth.ts';
import { spotify } from '../../spotify/client.ts';
import { syncSummary } from './summary.ts';
import { describeSync, runSync } from './sync.ts';

// Owned by the sync feature. Mounted at /api/sync.
export const syncRoutes = new Hono()
  .post('/', (c) => {
    const db = getDb();
    if (!readAuth(db)) throw new NotConnectedError();
    const job = startJob(
      'sync',
      async (ctx) => describeSync(await runSync(db, spotify(), (done, total, message) => ctx.progress(done, total, message))),
      db,
    );
    return c.json(job);
  })
  .get('/summary', (c) => c.json(syncSummary(getDb())));
