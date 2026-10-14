import { describe, expect, it } from 'vitest';
import { DJ_PLAYLIST_DESCRIPTION, type DjPoolOptions, type DjSetRecord, type DjSetResult, type DjSetSummary, type Job } from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { getJob } from '../../jobs/jobs.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import { makeDjRoutes } from './routes.ts';
import { config, seedLibrary } from './test-helpers.ts';

function setup() {
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
  const app = makeDjRoutes({ db: () => db, client: () => client });
  return { db, app, calls };
}

const post = (body: unknown) => ({ method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

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
});
