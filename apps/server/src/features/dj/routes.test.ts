import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DJ_CONFIG,
  DJ_PLAYLIST_DESCRIPTION,
  type AiPassAgents,
  type AiPassResult,
  type DjPoolOptions,
  type DjSetRecord,
  type DjSetResult,
  type DjSetSummary,
  type Job,
  type TransitionSettings,
} from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { getJob } from '../../jobs/jobs.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import type { RunAgent } from './ai-pass/run.ts';
import { makeDjRoutes, NO_AGENT_MESSAGE } from './routes.ts';
import { config, seedLibrary } from './test-helpers.ts';

function setup(ai: { agents?: () => AiPassAgents; runAgent?: RunAgent } = {}) {
  const db = openDb(':memory:');
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, authorized_at) VALUES (1, 'tok', 'r', ?, '', ?)`,
  ).run(Date.now() + 3_600_000, new Date().toISOString());
  seedLibrary(
    db,
    Array.from({ length: 30 }, (_, i) => ({
      id: `t${i}`,
      tempo: 118 + (i % 10),
      key: i % 12,
      mode: (i % 2) as 0 | 1,
      energy: 0.4 + (i % 6) / 10,
    })),
  );
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fakeFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.endsWith('/me/playlists')) {
      return new Response(JSON.stringify({ id: 'newpl', external_urls: { spotify: 'https://open.spotify.com/playlist/newpl' } }), {
        status: 201,
      });
    }
    return new Response(JSON.stringify({ snapshot_id: 'x' }), { status: 201 });
  }) as typeof fetch;
  const client = new SpotifyClient(db, fakeFetch, 0);
  const app = makeDjRoutes({ db: () => db, client: () => client, ...ai });
  return { db, app, calls };
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const patch = (body: unknown) => ({ ...post(body), method: 'PATCH' });
const poolCfg = (count: number) =>
  config({ pool: { playlistIds: ['pl1'], library: null, recent: { short_term: false, medium_term: false, long_term: false } }, length: { mode: 'tracks', count } });

/** Builds a preview, creates it as a set and waits for the job. */
async function createSet(app: ReturnType<typeof setup>['app'], db: DB, edit: (r: DjSetResult) => void = () => {}) {
  const cfg = poolCfg(6);
  const result = (await (await app.request('/preview', post({ config: cfg, seed: 2 }))).json()) as DjSetResult;
  edit(result);
  const res = await app.request('/sets', post({ name: 'Test set', config: cfg, result }));
  expect(res.status).toBe(202);
  const { job, setId } = (await res.json()) as { job: Job; setId: string };
  expect((await waitForJob(db, job.id)).status).toBe('done');
  return { setId, result };
}

const SLAM: TransitionSettings = {
  preset: 'Custom',
  bars: 2,
  volume: 'Center cut',
  eq: 'Quick bass cut',
  filter: 'Noise out end',
  effects: 'Echo 1 cut end',
  looping: '4 beat loop',
};

async function waitForJob(db: DB, id: string): Promise<Job> {
  for (let i = 0; i < 100; i++) {
    const job = getJob(id, db)!;
    if (job.status !== 'running') return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('job did not finish');
}

describe('dj routes', () => {
  it('GET /pool-options lists playlists and the BPM histogram', async () => {
    const { app } = setup();
    const res = await app.request('/pool-options');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DjPoolOptions;
    expect(body.playlists[0]).toMatchObject({ id: 'pl1', tracks: 30, withBpm: 30 });
    expect(body.bpmHistogram.length).toBeGreaterThan(0);
  });

  it('POST /preview builds a set and rejects a bad config', async () => {
    const { app } = setup();
    const cfg = config({ pool: { playlistIds: ['pl1'], library: null, recent: { short_term: false, medium_term: false, long_term: false } }, length: { mode: 'tracks', count: 10 } });
    const res = await app.request('/preview', post({ config: cfg, seed: 1 }));
    expect(res.status).toBe(200);
    const result = (await res.json()) as DjSetResult;
    expect(result.tracks).toHaveLength(10);
    expect(result.transitions).toHaveLength(9);

    const bad = await app.request('/preview', post({ config: { ...cfg, maxBpmStepPct: -1 }, seed: 1 }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/maxBpmStepPct/);
  });

  it('POST /sheet recomputes only the transitions, for the same tracks in the same order', async () => {
    const { app } = setup();
    const cfg = config({ pool: { playlistIds: ['pl1'], library: null, recent: { short_term: false, medium_term: false, long_term: false } }, length: { mode: 'tracks', count: 10 } });
    const set = (await (await app.request('/preview', post({ config: cfg, seed: 3 }))).json()) as DjSetResult;
    const subtle = { ...cfg, transitions: { ...cfg.transitions, colour: 'subtle' as const } };
    const bold = { ...cfg, transitions: { ...cfg.transitions, colour: 'bold' as const } };
    const sheet = async (c: typeof cfg) =>
      (await (await app.request('/sheet', post({ tracks: set.tracks, config: c }))).json()) as DjSetResult['transitions'];
    const a = await sheet(subtle);
    const b = await sheet(bold);
    expect(a).toHaveLength(9);
    expect(b).toHaveLength(9);
    // Same pairs, so tempo and key facts match; only the settings may differ.
    expect(b.map((t) => t.bpmDeltaPct)).toEqual(a.map((t) => t.bpmDeltaPct));
    expect(JSON.stringify(b.map((t) => t.settings))).not.toEqual(JSON.stringify(a.map((t) => t.settings)));

    const bad = await app.request('/sheet', post({ tracks: set.tracks.slice(0, 1), config: cfg }));
    expect(bad.status).toBe(400);
  });

  it('POST /sets creates the playlist in order and saves the set', async () => {
    const { app, db, calls } = setup();
    const cfg = config({ pool: { playlistIds: ['pl1'], library: null, recent: { short_term: false, medium_term: false, long_term: false } }, length: { mode: 'tracks', count: 8 } });
    const result = (await (await app.request('/preview', post({ config: cfg, seed: 4 }))).json()) as DjSetResult;

    const res = await app.request('/sets', post({ name: 'Friday warm-up', config: cfg, result }));
    expect(res.status).toBe(202);
    const { job, setId } = (await res.json()) as { job: Job; setId: string };
    expect((await waitForJob(db, job.id)).status).toBe('done');

    const create = calls.find((c) => c.url.endsWith('/me/playlists'))!;
    expect(create.body).toMatchObject({ name: 'Friday warm-up', description: DJ_PLAYLIST_DESCRIPTION, public: false });
    const add = calls.find((c) => c.url.includes('/playlists/newpl/items'))!;
    expect((add.body as { uris: string[] }).uris).toEqual(result.tracks.map((t) => t.uri));

    const list = (await (await app.request('/sets')).json()) as DjSetSummary[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: setId, name: 'Friday warm-up', tracks: 8, spotifyUrl: 'https://open.spotify.com/playlist/newpl' });

    const one = (await (await app.request(`/sets/${setId}`)).json()) as DjSetRecord;
    expect(one.result.tracks.map((t) => t.id)).toEqual(result.tracks.map((t) => t.id));
    expect(one.config.length).toEqual({ mode: 'tracks', count: 8 });
    expect((await app.request('/sets/nope')).status).toBe(404);
  });

  it('POST /sets needs a name', async () => {
    const { app } = setup();
    const cfg = config();
    const res = await app.request('/sets', post({ name: ' ', config: cfg, result: {} }));
    expect(res.status).toBe(400);
  });

  it('POST /preview fills an old or partial config up to the current shape', async () => {
    const { app } = setup();
    const { transitions: _t, ...rest } = poolCfg(6);
    const old = { ...rest, transitions: { defaultBars: 4, styles: { Fade: true, Rise: true, Blend: false }, rules: { autoWhenUnknown: false } } };
    const res = await app.request('/preview', post({ config: old, seed: 1 }));
    expect(res.status).toBe(200);
    const result = (await res.json()) as DjSetResult;
    expect(result.transitions[0]).toMatchObject({ applied: false, settings: { preset: expect.any(String) } });
    expect(result.transitions[0]!.settings).toEqual(result.transitions[0]!.suggested);

    const clubby = await app.request('/preview', post({ config: { ...poolCfg(6), transitions: { sheetStyle: 'club' } }, seed: 1 }));
    expect(clubby.status).toBe(200);
  });

  it('POST /sets keeps edited transitions and rejects unknown option names', async () => {
    const { app, db } = setup();
    const { setId, result } = await createSet(app, db, (r) => {
      r.transitions[1]!.settings = SLAM;
      r.transitions[2]!.applied = true;
    });
    const one = (await (await app.request(`/sets/${setId}`)).json()) as DjSetRecord;
    expect(one.result.transitions[1]!.settings).toEqual(SLAM);
    expect(one.result.transitions[1]!.suggested).toEqual(result.transitions[1]!.suggested);
    expect(one.applied).toBe(1);

    const cfg = poolCfg(6);
    const bad = structuredClone(result);
    bad.transitions[0]!.settings = { ...SLAM, volume: 'Slow crossfade' as TransitionSettings['volume'] };
    const res = await app.request('/sets', post({ name: 'Bad', config: cfg, result: bad }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/volume/);

    const badBars = structuredClone(result);
    badBars.transitions[0]!.suggested = { ...SLAM, bars: 3 as TransitionSettings['bars'] };
    expect((await app.request('/sets', post({ name: 'Bad', config: cfg, result: badBars }))).status).toBe(400);
  });

  it('PATCH /sets/:id/transitions/:index updates settings and applied', async () => {
    const { app, db } = setup();
    const { setId, result } = await createSet(app, db);

    const res = await app.request(`/sets/${setId}/transitions/0`, patch({ settings: SLAM }));
    expect(res.status).toBe(200);
    const after = (await res.json()) as DjSetRecord;
    expect(after.result.transitions[0]).toMatchObject({ settings: SLAM, suggested: result.transitions[0]!.suggested, applied: false });

    const ticked = (await (await app.request(`/sets/${setId}/transitions/4`, patch({ applied: true }))).json()) as DjSetRecord;
    expect(ticked.result.transitions[4]!.applied).toBe(true);
    expect(ticked.result.transitions[0]!.settings).toEqual(SLAM);
    expect(ticked.applied).toBe(1);

    const both = (await (await app.request(`/sets/${setId}/transitions/0`, patch({ applied: true, settings: result.transitions[0]!.suggested }))).json()) as DjSetRecord;
    expect(both.result.transitions[0]).toMatchObject({ settings: result.transitions[0]!.suggested, applied: true });

    const list = (await (await app.request('/sets')).json()) as DjSetSummary[];
    expect(list[0]!.applied).toBe(2);
  });

  it('PATCH validates the body and answers 404 for an unknown set or index', async () => {
    const { app, db } = setup();
    const { setId } = await createSet(app, db);
    const at = (i: string, body: unknown) => app.request(`/sets/${setId}/transitions/${i}`, patch(body));

    expect((await at('0', {})).status).toBe(400);
    expect((await at('0', { applied: 'yes' })).status).toBe(400);
    expect((await at('0', { settings: { ...SLAM, eq: 'Bass boost' } })).status).toBe(400);
    expect((await at('0', { settings: { ...SLAM, preset: 'Mystery' } })).status).toBe(400);
    expect((await at('5', { applied: true })).status).toBe(404);
    expect((await at('-1', { applied: true })).status).toBe(404);
    expect((await at('x', { applied: true })).status).toBe(404);
    expect((await app.request('/sets/nope/transitions/0', patch({ applied: true }))).status).toBe(404);
  });

  it('reads and migrates a set saved in the old shape', async () => {
    const { app, db } = setup();
    const track = (id: string, bpm: number, camelot: string | null, energy: number) => ({
      id,
      uri: `spotify:track:${id}`,
      name: `Track ${id}`,
      artists: ['Artist'],
      durationMs: 200_000,
      bpm,
      camelot,
      energy,
      targetEnergy: 0.6,
      locked: false,
    });
    const oldTransition = { style: 'Blend', bars: 8, bpmDeltaPct: 1.6, keyRelation: 'adjacent', energyDelta: 0, eqHint: 'Swap the lows.', cutHint: false, reason: 'old' };
    const oldResult = {
      seed: 1,
      tracks: [track('a', 124, '8A', 0.6), track('b', 126, '9A', 0.6), track('c', 127, null, 0.6)],
      transitions: [oldTransition, { ...oldTransition, style: 'Auto', bars: null, keyRelation: 'unknown' }],
      score: { total: 80, bpmSmooth: 1, keyCompatible: 1, energyFit: 1, artistRepeats: 0, cost: 1 },
      warnings: [],
      pool: { total: 3, usable: 3, noTempo: 0, outOfBpmRange: 0, noKey: 1, noEnergy: 0 },
      durationMs: 600_000,
    };
    const { transitions: _t, ...rest } = DEFAULT_DJ_CONFIG;
    const oldConfig = { ...rest, transitions: { defaultBars: 8, styles: { Fade: true, Rise: true, Blend: true }, rules: DEFAULT_DJ_CONFIG.transitions.rules } };
    db.prepare(`INSERT INTO dj_sets (id, name, config_json, result_json, spotify_playlist_id, created_at) VALUES ('old', 'Old set', ?, ?, 'pl-old', ?)`).run(
      JSON.stringify(oldConfig),
      JSON.stringify(oldResult),
      new Date().toISOString(),
    );

    const list = (await (await app.request('/sets')).json()) as DjSetSummary[];
    expect(list[0]).toMatchObject({ id: 'old', tracks: 3, applied: 0 });

    const one = (await (await app.request('/sets/old')).json()) as DjSetRecord;
    expect(one.config.transitions).toEqual({ sheetStyle: 'balanced', colour: 'medium', defaultBars: 8, rules: DEFAULT_DJ_CONFIG.transitions.rules });
    // Old tracks have no instrumentalness, so they count as vocal: no long overlap.
    expect(one.result.transitions[0]).toMatchObject({
      settings: { preset: 'Custom', bars: 8, volume: 'Crossfade', eq: '3-band fade' },
      keyRelation: 'adjacent',
      barsMayBeHidden: false,
      ai: null,
      applied: false,
    });
    expect(one.result.tracks[0]).toMatchObject({ instrumentalness: null, tags: [] });
    expect(one.result.transitions[0]).not.toHaveProperty('eqHint');
    expect(one.result.transitions[1]!.settings.preset).toBe('Auto');

    const ticked = (await (await app.request('/sets/old/transitions/1', patch({ applied: true }))).json()) as DjSetRecord;
    expect(ticked.applied).toBe(1);
    const stored = JSON.parse((db.prepare(`SELECT result_json FROM dj_sets WHERE id = 'old'`).get() as { result_json: string }).result_json) as DjSetResult;
    expect(stored.transitions[0]!.settings.volume).toBe('Crossfade');
    expect(stored.transitions[1]!.applied).toBe(true);
  });
});

describe('AI pass routes', () => {
  const CLAUDE: AiPassAgents = { available: ['claude', 'codex'], selected: 'claude' };
  const AI: TransitionSettings = {
    preset: 'Custom',
    bars: 4,
    volume: 'Fade in fade out',
    eq: '3-band fade',
    filter: 'Low pass filter out',
    effects: 'Echo ¾ out end',
    looping: 'None',
  };
  /** Answers like `claude --output-format json`: every pair gets AI, except pair 3 has an unknown EQ. */
  const fakeClaude = (prompts: string[]): RunAgent => async (_cli, prompt) => {
    prompts.push(prompt);
    const pairs = Number(/Set: \d+ tracks, (\d+) transitions/.exec(prompt)![1]);
    const transitions = Array.from({ length: pairs }, (_, index) => ({ index, ...AI, ...(index === 3 ? { eq: 'Bass boost' } : {}), reason: `AI reason ${index}` }));
    return JSON.stringify({ type: 'result', is_error: false, result: '```json\n' + JSON.stringify({ summary: 'Darker and smoother.', transitions }) + '\n```' });
  };

  async function finish(app: ReturnType<typeof setup>['app'], db: DB, res: Response) {
    expect(res.status).toBe(202);
    const job = (await res.json()) as Job;
    expect(job.kind).toBe('dj-ai-pass');
    const done = await waitForJob(db, job.id);
    return { done, res: await app.request(`/ai-pass/${job.id}`) };
  }

  it('GET /ai-pass/agents lists the CLIs', async () => {
    const { app } = setup({ agents: () => CLAUDE });
    expect(await (await app.request('/ai-pass/agents')).json()).toEqual(CLAUDE);
  });

  it('POST /ai-pass without a CLI answers 400 with the install hint', async () => {
    const { app } = setup({ agents: () => ({ available: [], selected: null }) });
    const preview = (await (await app.request('/preview', post({ config: poolCfg(4), seed: 1 }))).json()) as DjSetResult;
    const res = await app.request('/ai-pass', post({ tracks: preview.tracks, transitions: preview.transitions }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe(NO_AGENT_MESSAGE);
  });

  it('validates the request', async () => {
    const { app } = setup({ agents: () => CLAUDE, runAgent: fakeClaude([]) });
    expect((await app.request('/ai-pass', post({}))).status).toBe(400);
    expect((await app.request('/ai-pass', post({ setId: 'nope' }))).status).toBe(404);
    const preview = (await (await app.request('/preview', post({ config: poolCfg(4), seed: 1 }))).json()) as DjSetResult;
    expect((await app.request('/ai-pass', post({ tracks: preview.tracks, transitions: preview.transitions.slice(1) }))).status).toBe(400);
  });

  it('a preview pass returns the validated suggestions only', async () => {
    const prompts: string[] = [];
    const { app, db } = setup({ agents: () => CLAUDE, runAgent: fakeClaude(prompts) });
    const preview = (await (await app.request('/preview', post({ config: poolCfg(6), seed: 2 }))).json()) as DjSetResult;
    expect(preview.tracks[0]).toHaveProperty('instrumentalness');
    expect(preview.tracks[0]).toHaveProperty('tags');
    expect(preview.transitions[0]).toMatchObject({ ai: null, barsMayBeHidden: expect.any(Boolean) });

    const { done, res } = await finish(app, db, await app.request('/ai-pass', post({ tracks: preview.tracks, transitions: preview.transitions, config: poolCfg(6), focus: 'darker' })));
    expect(done).toMatchObject({ status: 'done', message: 'Claude Code reviewed 4 transitions; 1 answer was invalid and kept the rule version.' });
    const result = (await res.json()) as AiPassResult;
    expect(result).toMatchObject({ agent: 'claude', summary: 'Darker and smoother.', set: null });
    expect(result.transitions.map((t) => t.index)).toEqual([0, 1, 2, 4]);
    expect(result.transitions[0]).toEqual({ index: 0, settings: AI, reason: 'AI reason 0' });
    expect(result.rejected).toEqual([{ index: 3, problem: 'eq "Bass boost" is not a Spotify option' }]);
    expect(prompts[0]).toContain("The user's focus: darker");
    expect(prompts[0]).toContain(`out: ${preview.tracks[0]!.name}`);
  });

  it('a saved-set pass stores the AI version and keeps the user’s edits', async () => {
    const { app, db } = setup({ agents: () => CLAUDE, runAgent: fakeClaude([]) });
    const { setId, result } = await createSet(app, db);
    await app.request(`/sets/${setId}/transitions/1`, patch({ settings: SLAM }));

    const { res } = await finish(app, db, await app.request('/ai-pass', post({ setId })));
    const out = (await res.json()) as AiPassResult;
    const set = out.set!;
    expect(set.id).toBe(setId);
    const [t0, t1, , t3] = set.result.transitions;
    expect(t0).toMatchObject({ settings: AI, suggested: result.transitions[0]!.suggested, ai: { settings: AI, reason: 'AI reason 0', agent: 'claude' } });
    expect(t1).toMatchObject({ settings: SLAM, ai: { settings: AI } });
    expect(t3).toMatchObject({ settings: result.transitions[3]!.suggested, ai: null });

    const stored = (await (await app.request(`/sets/${setId}`)).json()) as DjSetRecord;
    expect(stored.result.transitions[0]!.ai?.agent).toBe('claude');

    // A second pass replaces the AI version where the user kept it.
    const again = await finish(app, db, await app.request('/ai-pass', post({ setId })));
    expect(((await again.res.json()) as AiPassResult).set!.result.transitions[0]!.settings).toEqual(AI);
  });

  it('answers 409 while a pass runs, and fails the job on an answer without JSON', async () => {
    let release: (v: string) => void = () => {};
    const { app, db } = setup({ agents: () => CLAUDE, runAgent: () => new Promise<string>((r) => (release = r)) });
    const preview = (await (await app.request('/preview', post({ config: poolCfg(4), seed: 1 }))).json()) as DjSetResult;
    const body = post({ tracks: preview.tracks, transitions: preview.transitions });
    const first = await app.request('/ai-pass', body);
    expect(first.status).toBe(202);
    const job = (await first.json()) as Job;
    expect((await app.request(`/ai-pass/${job.id}`)).status).toBe(404);
    expect((await app.request('/ai-pass', body)).status).toBe(409);

    release('Sorry, I cannot do that.');
    const done = await waitForJob(db, job.id);
    expect(done.status).toBe('failed');
    expect(done.error).toMatch(/did not answer with the JSON/);
    const res = await app.request(`/ai-pass/${job.id}`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/did not answer with the JSON/);
    expect((await app.request('/ai-pass/unknown-job')).status).toBe(404);
  });

  it('reads stored 16-bar transitions as 8 and accepts them in a new set', async () => {
    const { app, db } = setup();
    const { setId, result } = await createSet(app, db);
    const stored = JSON.parse((db.prepare('SELECT result_json FROM dj_sets WHERE id = ?').get(setId) as { result_json: string }).result_json) as DjSetResult;
    const custom = stored.transitions.findIndex((t) => t.settings.preset === 'Custom');
    stored.transitions[custom]!.settings.bars = 16 as TransitionSettings['bars'];
    for (const t of stored.transitions) delete (t as Partial<typeof t>).barsMayBeHidden;
    db.prepare('UPDATE dj_sets SET result_json = ? WHERE id = ?').run(JSON.stringify(stored), setId);

    const one = (await (await app.request(`/sets/${setId}`)).json()) as DjSetRecord;
    expect(one.result.transitions[custom]!.settings.bars).toBe(8);
    expect(one.result.transitions.every((t) => typeof t.barsMayBeHidden === 'boolean')).toBe(true);

    const old = structuredClone(result);
    old.transitions[custom]!.suggested.bars = 16 as TransitionSettings['bars'];
    const cfg = { ...poolCfg(6), transitions: { ...poolCfg(6).transitions, defaultBars: 16 } };
    const res = await app.request('/sets', post({ name: 'Old bars', config: cfg, result: old }));
    expect(res.status).toBe(202);
  });
});
