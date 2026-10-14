import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';

const memory = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../../db/db.ts', async (orig) => {
  const mod = await orig<typeof import('../../db/db.ts')>();
  memory.db = mod.openDb(':memory:');
  return { ...mod, getDb: () => memory.db };
});

const { pruneRoutes } = await import('./routes.ts');

const row = (ts: string, uri: string | null) => ({ ts, ms_played: 60000, spotify_track_uri: uri, spotify_episode_uri: null });

describe('prune routes', () => {
  it('imports an uploaded zip and reports it in the summary', async () => {
    const zip = zipSync({
      'Spotify Extended Streaming History/Streaming_History_Audio_2024_0.json': strToU8(
        JSON.stringify([row('2024-01-01T00:00:00Z', 'spotify:track:a'), row('2024-02-01T00:00:00Z', null)]),
      ),
    });
    const form = new FormData();
    form.append('files', new File([zip], 'my_spotify_data.zip'));
    const res = await pruneRoutes.request('/history', { method: 'POST', body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { inserted: number; skipped: number } };
    expect(body.result).toMatchObject({ inserted: 1, skipped: 1 });

    const summary = await (await pruneRoutes.request('/history/summary')).json();
    expect(summary).toMatchObject({ rows: 1, firstTs: '2024-01-01T00:00:00Z' });
  });

  it('rejects uploads without history files', async () => {
    const form = new FormData();
    form.append('files', new File(['hello'], 'notes.txt'));
    const res = await pruneRoutes.request('/history', { method: 'POST', body: form });
    expect(res.status).toBe(400);
  });

  it('serves candidates with a clamped months value', async () => {
    const res = await pruneRoutes.request('/candidates?months=999');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ months: 120, playlists: [] });
  });

  it('validates the prune body', async () => {
    const res = await pruneRoutes.request('/', { method: 'POST', body: JSON.stringify({ playlistIds: [] }) });
    expect(res.status).toBe(400);
  });
});
