import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_DJ_CONFIG, type AgentCli, type AiPassAgents, type AiPassResult } from '@curator/shared';
import { getDb, type DB } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { getJob, latestJob, startJob } from '../../jobs/jobs.ts';
import { spotify, type SpotifyClient } from '../../spotify/client.ts';
import { buildDjSet } from './order.ts';
import { buildCandidates, poolOptions } from './pool.ts';
import { AGENT_LABEL, detectAgents, runAgentCli } from './ai-pass/agents.ts';
import type { AiPassInput } from './ai-pass/prompt.ts';
import { applyAiToSet, runAiPass, type RunAgent } from './ai-pass/run.ts';
import { aiPassRequestSchema, djCreateSchema, djPreviewSchema, djSheetSchema, djTransitionPatchSchema } from './schema.ts';
import { createDjSet, getDjSet, listDjSets, patchDjTransition, sheetFor } from './sets.ts';

interface Deps {
  db: () => DB;
  client: () => SpotifyClient;
  /** Agent CLIs on PATH (ADR 0004). Injected in tests. */
  agents?: () => AiPassAgents;
  runAgent?: RunAgent;
}

export const NO_AGENT_MESSAGE = 'No agent CLI found. Install Claude Code, Codex or Gemini CLI and log in, or set AGENT_CLI.';

const realRunAgent: RunAgent = (cli: AgentCli, prompt, signal) => runAgentCli(cli, prompt, { signal });

async function parse<T>(schema: z.ZodType<T>, req: { json: () => Promise<unknown> }) {
  const body = await req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { error: z.prettifyError(parsed.error) };
}

export function makeDjRoutes(deps: Deps) {
  const agents = deps.agents ?? (() => detectAgents());
  const runAgent = deps.runAgent ?? realRunAgent;
  // AI pass results live in memory: they are only needed while the page watches the job.
  const aiResults = new Map<string, AiPassResult>();

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
    .post('/sheet', async (c) => {
      const p = await parse(djSheetSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      return c.json(sheetFor(p.data.tracks, p.data.config));
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
    })
    .get('/ai-pass/agents', (c) => c.json(agents()))
    .post('/ai-pass', async (c) => {
      const p = await parse(aiPassRequestSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const cli = agents().selected;
      if (!cli) return c.json({ error: NO_AGENT_MESSAGE }, 400);
      const db = deps.db();
      if (latestJob('dj-ai-pass', db)?.status === 'running') {
        return c.json({ error: 'An AI pass is running already. Wait for it to finish.' }, 409);
      }
      const req = p.data;
      let input: AiPassInput;
      if (req.setId) {
        const set = getDjSet(db, req.setId);
        if (!set) return c.json({ error: 'DJ Set not found' }, 404);
        input = { tracks: set.result.tracks, transitions: set.result.transitions, config: set.config, focus: req.focus };
      } else {
        input = { tracks: req.tracks!, transitions: req.transitions!, config: req.config ?? DEFAULT_DJ_CONFIG, focus: req.focus };
      }
      if (input.transitions.length === 0) return c.json({ error: 'The set needs at least two tracks.' }, 400);

      const job = startJob(
        'dj-ai-pass',
        async (ctx) => {
          const parsed = await runAiPass(input, cli, runAgent, ctx.progress, ctx.signal);
          const set = req.setId ? applyAiToSet(db, req.setId, parsed, cli) : null;
          aiResults.set(ctx.jobId, { agent: cli, ...parsed, set });
          const n = parsed.transitions.length;
          const bad = parsed.rejected.length;
          return `${AGENT_LABEL[cli]} reviewed ${n} transition${n === 1 ? '' : 's'}${bad ? `; ${bad} answer${bad === 1 ? ' was' : 's were'} invalid and kept the rule version` : ''}.`;
        },
        db,
      );
      return c.json(job, 202);
    })
    .get('/ai-pass/:jobId', (c) => {
      const jobId = c.req.param('jobId');
      const job = getJob(jobId, deps.db());
      if (!job) return c.json({ error: 'Job not found.' }, 404);
      const result = aiResults.get(jobId);
      if (result) return c.json(result);
      return c.json({ error: job.status === 'running' ? 'The AI pass is still running.' : (job.error ?? 'No result for this job.') }, 404);
    });
}

// Owned by the dj feature. Mounted at /api/dj.
export const djRoutes = makeDjRoutes({ db: getDb, client: spotify });
