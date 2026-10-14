import { relative } from 'node:path';
import { Hono } from 'hono';
import { getDb, ROOT_DIR } from '../../db/db.ts';
import { startJob } from '../../jobs/jobs.ts';
import { spotify } from '../../spotify/client.ts';
import { runEnrich } from './enrich.ts';
import { coverage, isMissing, isSort, libraryRows, queryLibrary } from './library-view.ts';
import { enrichStatus } from './status.ts';
import { buildSnapshot, SNAPSHOT_FILE, snapshotSummary, writeSnapshot } from './snapshot.ts';

// Owned by the enrich feature. Mounted at /api/enrich.
export const enrichRoutes = new Hono()
  .post('/', (c) =>
    c.json(startJob('enrich', (ctx) => runEnrich(getDb(), { fetch, spotify: spotify(), signal: ctx.signal }, ctx.progress))),
  )
  .post('/snapshot', (c) =>
    c.json(
      startJob('snapshot', async (ctx) => {
        ctx.progress(0, 1, 'Building the Snapshot');
        const snapshot = buildSnapshot(getDb());
        const bytes = writeSnapshot(snapshot);
        ctx.progress(1, 1, 'Snapshot written');
        return `${snapshotSummary(snapshot, bytes)} Saved to ${relative(ROOT_DIR, SNAPSHOT_FILE)}.`;
      }),
    ),
  )
  .get('/coverage', (c) => c.json(coverage(getDb())))
  .get('/status', (c) => c.json(enrichStatus(getDb())))
  .get('/tracks', (c) => {
    const q = c.req.query();
    const num = (v: string | undefined) => (v && Number.isFinite(Number(v)) ? Number(v) : undefined);
    return c.json(
      queryLibrary(libraryRows(getDb()), {
        q: q.q,
        sort: isSort(q.sort) ? q.sort : undefined,
        dir: q.dir === 'desc' ? 'desc' : 'asc',
        offset: num(q.offset),
        limit: num(q.limit),
        missing: isMissing(q.missing) ? q.missing : undefined,
      }),
    );
  });
