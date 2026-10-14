import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_DJ_CONFIG, type AgentCli, type AiPassAgents, type AiPassResult } from '@curator/shared';
import { getDb, type DB } from '../../db/db.ts';
import { DEMO_MESSAGE, isDemo } from '../../demo/guard.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { getJob, latestJob, startJob } from '../../jobs/jobs.ts';
import { spotify, type SpotifyClient } from '../../spotify/client.ts';
import { buildDjSet } from './order.ts';
import { buildCandidates, poolOptions } from './pool.ts';
import { AGENT_LABEL, detectAgents, runAgentCli } from './ai-pass/agents.ts';
import type { AiPassInput } from './ai-pass/prompt.ts';
import { applyAiToSet, runAiPass, type RunAgent } from './ai-pass/run.ts';
import {
  aiPassRequestSchema,
  djCreateSchema,
  djDraftSchema,
  djDraftUpdateSchema,
  djPreviewSchema,
  djSheetSchema,
  djSpotifyUpdateSchema,
  djTemplateInputSchema,
  djTemplatePatchSchema,
  djTransitionPatchSchema,
  djWorkspaceSchema,
} from './schema.ts';
import { clearWorkspace, getWorkspace, saveWorkspace } from './workspace.ts';
import {
  createDjDraftOnSpotify,
  createDjSet,
  deleteDjSet,
  getDjSet,
  listDjSets,
  patchDjTransition,
  saveDjDraft,
  sheetFor,
  updateDjDraft, updateDjSetOnSpotify } from './sets.ts';
import { createTemplate, deleteTemplate, listTemplates, TemplateNameTakenError, updateTemplate } from './templates.ts';

interface Deps {
  db: () => DB;
  client: () => SpotifyClient;
  /** Agent CLIs on PATH (ADR 0004). Injected in tests. */
  agents?: () => AiPassAgents;
  runAgent?: RunAgent;
}

export const CREATING_MESSAGE = 'A DJ Set is being created already. Wait for it to finish.';
export const CREATED_SET_MESSAGE = "Created sets can't be replaced; save a new draft.";
export const DRAFT_BUSY_MESSAGE = 'This draft is being created on Spotify. Wait for it to finish.';

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
  // The draft whose create job runs now; it may not change or go away meanwhile.
  let creatingDraftId: string | null = null;
  const createRunning = (db: DB) => latestJob('create-dj-set', db)?.status === 'running';

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
    .get('/workspace', (c) => c.json(getWorkspace(deps.db())))
    .put('/workspace', async (c) => {
      const p = await parse(djWorkspaceSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      return c.json(saveWorkspace(deps.db(), p.data));
    })
    .delete('/workspace', (c) => {
      clearWorkspace(deps.db());
      return c.body(null, 204);
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
      if (createRunning(db)) return c.json({ error: CREATING_MESSAGE }, 409);
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
    .post('/drafts', async (c) => {
      const p = await parse(djDraftSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      return c.json(saveDjDraft(deps.db(), randomUUID(), p.data), 201);
    })
    .put('/sets/:id', async (c) => {
      const p = await parse(djDraftUpdateSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const db = deps.db();
      const id = c.req.param('id');
      const set = getDjSet(db, id);
      if (!set) return c.json({ error: 'DJ Set not found' }, 404);
      if (set.status === 'created') return c.json({ error: CREATED_SET_MESSAGE }, 409);
      if (creatingDraftId === id) return c.json({ error: DRAFT_BUSY_MESSAGE }, 409);
      return c.json(updateDjDraft(db, id, p.data));
    })
    .post('/sets/:id/create', (c) => {
      // The demo guard only blocks POST /api/dj/sets; this path writes to Spotify too.
      if (isDemo()) return c.json({ error: DEMO_MESSAGE, code: 'demo' }, 403);
      const db = deps.db();
      const draft = getDjSet(db, c.req.param('id'));
      if (!draft) return c.json({ error: 'DJ Set not found' }, 404);
      if (draft.status === 'created') return c.json({ error: 'This set is on Spotify already.' }, 409);
      if (createRunning(db)) return c.json({ error: CREATING_MESSAGE }, 409);
      creatingDraftId = draft.id;
      const job = startJob(
        'create-dj-set',
        async (ctx) => {
          try {
            await createDjDraftOnSpotify(db, deps.client(), draft, ctx.progress);
            return `Created “${draft.name}” with ${draft.result.tracks.length} tracks.`;
          } finally {
            creatingDraftId = null;
          }
        },
        db,
      );
      return c.json({ job, setId: draft.id }, 202);
    })
    .post('/sets/:id/update', async (c) => {
      if (isDemo()) return c.json({ error: DEMO_MESSAGE, code: 'demo' }, 403);
      const p = await parse(djSpotifyUpdateSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      const db = deps.db();
      const set = getDjSet(db, c.req.param('id'));
      if (!set) return c.json({ error: 'DJ Set not found' }, 404);
      if (set.status !== 'created' || !set.spotifyPlaylistId) {
        return c.json({ error: 'Only a set that is on Spotify can be updated there. Create it on Spotify first.' }, 409);
      }
      if (createRunning(db) || latestJob('update-dj-set', db)?.status === 'running') return c.json({ error: CREATING_MESSAGE }, 409);
      const req = p.data;
      const job = startJob(
        'update-dj-set',
        async (ctx) => {
          const r = await updateDjSetOnSpotify(db, deps.client(), set, req, ctx.progress);
          const ticks = r.changedPairs ? ` ${r.changedPairs} changed pair(s) need applying in Mix again.` : '';
          const rename = r.renameFailed ? ' The name could not be changed on Spotify.' : r.renamed ? ` Renamed to “${req.name}”.` : '';
          return `Updated “${set.name}” on Spotify with ${req.result.tracks.length} tracks.${rename}${ticks}`;
        },
        db,
      );
      return c.json({ job, setId: set.id }, 202);
    })
    .delete('/sets/:id', (c) => {
      const id = c.req.param('id');
      if (creatingDraftId === id) return c.json({ error: DRAFT_BUSY_MESSAGE }, 409);
      return deleteDjSet(deps.db(), id) ? c.body(null, 204) : c.json({ error: 'DJ Set not found' }, 404);
    })
    .get('/templates', (c) => c.json(listTemplates(deps.db())))
    .post('/templates', async (c) => {
      const p = await parse(djTemplateInputSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      try {
        return c.json(createTemplate(deps.db(), p.data), 201);
      } catch (err) {
        if (err instanceof TemplateNameTakenError) return c.json({ error: err.message }, 409);
        throw err;
      }
    })
    .patch('/templates/:id', async (c) => {
      const p = await parse(djTemplatePatchSchema, c.req);
      if ('error' in p) return c.json({ error: p.error }, 400);
      try {
        const template = updateTemplate(deps.db(), c.req.param('id'), p.data);
        return template ? c.json(template) : c.json({ error: 'Template not found' }, 404);
      } catch (err) {
        if (err instanceof TemplateNameTakenError) return c.json({ error: err.message }, 409);
        throw err;
      }
    })
    .delete('/templates/:id', (c) =>
      deleteTemplate(deps.db(), c.req.param('id')) ? c.body(null, 204) : c.json({ error: 'Template not found' }, 404),
    )
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
