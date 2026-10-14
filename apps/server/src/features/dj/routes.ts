import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb, type DB } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { latestJob, startJob } from '../../jobs/jobs.ts';
import { spotify, type SpotifyClient } from '../../spotify/client.ts';
import { buildDjSet } from './order.ts';
import { buildCandidates, poolOptions } from './pool.ts';
import { djCreateSchema, djPreviewSchema, djTransitionPatchSchema } from './schema.ts';
import { createDjSet, getDjSet, listDjSets, patchDjTransition } from './sets.ts';

interface Deps {
  db: () => DB;
  client: () => SpotifyClient;
}

async function parse<T>(schema: z.ZodType<T>, req: { json: () => Promise<unknown> }) {
  const body = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { error: z.prettifyError(parsed.error) };
}

export function makeDjRoutes(deps: Deps) {
  return new Hono()
    .get('/pool-options', (c) => {
      const db = deps.db();
      return c.json(poolOptions(db, getLibraryTracks(db)));
    })
    .post('/preview', async (c) => {
      const p = await parse(djPreviewSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const { config, seed } = p.data;
      const { candidates, stats, warnings } = buildCandidates(getLibraryTracks(deps.db()), config);
      return c.json(buildDjSet(candidates, config, seed, stats, warnings));
    })
    .post('/sets', async (c) => {
      const p = await parse(djCreateSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const db = deps.db();
      if (latestJob('create-dj-set', db)?.status === 'running') {
        return c.json({ error: 'A DJ Set is being created already. Wait for it to finish.' }, 409);
      }
      const id = randomUUID();
      const req = p.data;
      const job = startJob(
        'create-dj-set',
        async (ctx) => {
          await createDjSet(db, deps.client(), id, req, ctx.progress);
          return `Created “${req.name}” with ${req.result.tracks.length} tracks.`;
        },
        db,
      );
      return c.json({ job, setId: id }, 202);
    })
    .get('/sets', (c) => c.json(listDjSets(deps.db())))
    .get('/sets/:id', (c) => {
      const set = getDjSet(deps.db(), c.req.param('id'));
      return set ? c.json(set) : c.json({ error: 'DJ Set not found' }, 404);
    })
    .patch('/sets/:id/transitions/:index', async (c) => {
      const p = await parse(djTransitionPatchSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const index = Number(c.req.param('index'));
      const set = Number.isInteger(index) ? patchDjTransition(deps.db(), c.req.param('id'), index, p.data) : null;
      return set ? c.json(set) : c.json({ error: 'DJ Set or transition not found' }, 404);
    });
}

// Owned by the dj feature. Mounted at /api/dj.
export const djRoutes = makeDjRoutes({ db: getDb, client: spotify });
