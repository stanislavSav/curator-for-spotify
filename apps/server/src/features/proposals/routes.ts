import { Hono } from 'hono';
import {
  ApplyProposalsSchema,
  BasicProposalsRequestSchema,
  ProposalPatchSchema,
  type BasicProposalsResponse,
} from '@curator/shared';
import { getDb, type DB } from '../../db/db.ts';
import { startJob } from '../../jobs/jobs.ts';
import { NotConnectedError, readAuth } from '../../spotify/auth.ts';
import { spotify } from '../../spotify/client.ts';
import { writeBasicProposals } from './basic.ts';
import {
  ProposalError,
  applicableIds,
  applyProposals,
  applySummary,
  defaultPaths,
  getProposals,
  patchProposal,
  type ProposalPaths,
} from './service.ts';

export interface ProposalsRouteDeps {
  db: () => DB;
  paths: () => ProposalPaths;
}

// Mounted at /api/proposals. The proposals file is re-read on every request,
// so a new file from an Agent shows up without a restart.
export const makeProposalsRoutes = (deps: ProposalsRouteDeps = { db: getDb, paths: defaultPaths }) =>
  new Hono()
    .onError((err, c) => {
      if (err instanceof ProposalError)
        return c.json(err.code ? { error: err.message, code: err.code } : { error: err.message }, err.status);
      throw err;
    })
    .get('/', (c) => c.json(getProposals(deps.db(), deps.paths())))
    .post('/basic', async (c) => {
      const text = await c.req.text();
      let json: unknown = {};
      try {
        json = text.trim() ? JSON.parse(text) : {};
      } catch {
        json = null;
      }
      const body = BasicProposalsRequestSchema.safeParse(json);
      if (!body.success) return c.json({ error: 'Send {} or { replace: true }.' }, 400);
      const result: BasicProposalsResponse = writeBasicProposals(deps.db(), { replace: body.data.replace, paths: deps.paths() });
      return c.json(result);
    })
    .patch('/:id', async (c) => {
      const body = ProposalPatchSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: body.error.issues.map((i) => i.message).join('; ') }, 400);
      patchProposal(deps.db(), c.req.param('id'), body.data, deps.paths());
      return c.json({ ok: true });
    })
    .post('/apply', async (c) => {
      const body = ApplyProposalsSchema.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: 'Send { ids: string[] } with at least one id.' }, 400);
      const db = deps.db();
      const paths = deps.paths();
      if (!readAuth(db)) throw new NotConnectedError();
      const ids = applicableIds(db, body.data.ids, paths);
      if (ids.length === 0) return c.json({ error: 'None of these proposals is approved and not yet created.' }, 409);
      const job = startJob(
        'apply-proposals',
        async (ctx) => {
          const result = await applyProposals(db, spotify(), ids, ctx.progress, paths);
          const summary = applySummary(result);
          if (result.failed.length > 0) throw new Error(summary);
          return summary;
        },
        db,
      );
      return c.json(job);
    });

export const proposalsRoutes = makeProposalsRoutes();
