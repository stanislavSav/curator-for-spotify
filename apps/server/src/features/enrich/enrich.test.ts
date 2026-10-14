import { describe, expect, it } from 'vitest';
import type { DB } from '../../db/db.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import { runEnrich, type EnrichDeps } from './enrich.ts';
import { fakeFetch, noSleep, seedDb, sid } from './test-fixtures.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const RECCO = 'https://api.reccobeats.com/';
const DEEZER = 'https://api.deezer.com/';
const MB = 'https://musicbrainz.org/';
const SPOTIFY = 'https://api.spotify.com/';
const WIKIDATA = 'https://query.wikidata.org/';
// The batched phases: no Spotify links and no Wikidata genres unless a test says so.
const NO_LINKS = { [`${MB}ws/2/url`]: () => undefined, [WIKIDATA]: () => ({ results: { bindings: [] } }) };
/** Per-artist MusicBrainz calls (phase f), not the batched link lookups. */
const mbSlow = (calls: string[]) => calls.filter((c) => c.startsWith(MB) && !c.startsWith(`${MB}ws/2/url`));

const A = { id: sid('artistA'), name: 'Alpha' };
const B = { id: sid('artistB'), name: 'Beta' };

function seed() {
  return seedDb(
    [
      { id: sid('t1'), isrc: 'ISRC1', artists: [A] }, // ReccoBeats knows it
      { id: sid('t2'), isrc: 'ISRC2', artists: [A, B] }, // only Deezer knows the BPM
      { id: sid('t3'), isrc: null, artists: [B] }, // unknown everywhere, no ISRC
    ],
    { connected: true },
  );
}

const reccoBody = (ids: string[]) => ({
  content: ids
    .filter((id) => id === sid('t1'))
    .map((id) => ({ id: 'uuid', href: `https://open.spotify.com/track/${id}`, tempo: 123.456, key: 9, mode: 0, energy: 0.8 })),
});

function routes(opts: { genres?: string[] } = {}) {
  return fakeFetch({
    ...NO_LINKS,
    [RECCO]: (u) => reccoBody(u.searchParams.get('ids')!.split(',')),
    [DEEZER]: (u) => (u.pathname.endsWith('ISRC2') ? { id: 2, bpm: 99.5 } : { error: { code: 800, message: 'no data' } }),
    [`${MB}ws/2/isrc/`]: (u) =>
      u.pathname.endsWith('ISRC1')
        ? { recordings: [{ 'artist-credit': [{ artist: { id: 'mb-a', name: 'Alpha', tags: [{ name: 'House', count: 4 }, { name: 'disco', count: 2 }] } }] }] }
        : {
            recordings: [
              {
                'artist-credit': [
                  { artist: { id: 'mb-a', name: 'Alpha', tags: [{ name: 'house', count: 4 }] } },
                  { artist: { id: 'mb-b', name: 'Beta', tags: [{ name: 'techno', count: 5 }] } },
                ],
              },
            ],
          },
    [`${MB}ws/2/artist/`]: () => ({ artists: [] }),
    [SPOTIFY]: () => ({ id: 'x', genres: opts.genres ?? ['Deep House'] }),
  });
}

function deps(db: DB, f: ReturnType<typeof fakeFetch>, extra: Partial<EnrichDeps> = {}): EnrichDeps {
  return {
    fetch: f.fetch,
    spotify: new SpotifyClient(db, f.fetch, 0),
    sleep: noSleep,
    now: () => NOW,
    ...extra,
  };
}

const features = (db: DB) =>
  db.prepare('SELECT track_id, source, tempo, key, mode, energy FROM audio_features ORDER BY track_id').all();
const tags = (db: DB, source: string) =>
  db.prepare('SELECT entity_id, tag, weight FROM tags WHERE source = ? ORDER BY entity_id, weight DESC').all(source);

describe('runEnrich', () => {
  it('fills features from ReccoBeats, BPM from Deezer, and tags from Spotify and MusicBrainz', async () => {
    const db = seed();
    const f = routes();
    const message = await runEnrich(db, deps(db, f));

    expect(features(db)).toEqual([
      { track_id: sid('t1'), source: 'reccobeats', tempo: 123.456, key: 9, mode: 0, energy: 0.8 },
      { track_id: sid('t2'), source: 'deezer', tempo: 99.5, key: null, mode: null, energy: null },
    ]);
    // One ReccoBeats call for all three tracks; Deezer only for t2 (t1 has tempo, t3 has no ISRC).
    expect(f.calls.filter((c) => c.startsWith(RECCO))).toHaveLength(1);
    expect(f.calls.filter((c) => c.startsWith(DEEZER))).toEqual([`${DEEZER}track/isrc:ISRC2`]);

    expect(tags(db, 'spotify-genre')).toEqual([
      { entity_id: A.id, tag: 'deep house', weight: 1 },
      { entity_id: B.id, tag: 'deep house', weight: 1 },
    ]);
    expect(db.prepare('SELECT genres_json FROM artists WHERE id = ?').pluck().get(A.id)).toBe('["Deep House"]');

    // Alpha via its solo track (ISRC1), Beta via t2 (ISRC2).
    expect(tags(db, 'musicbrainz')).toEqual([
      { entity_id: A.id, tag: 'house', weight: 1 },
      { entity_id: A.id, tag: 'disco', weight: 0.5 },
      { entity_id: B.id, tag: 'techno', weight: 1 },
    ]);
    expect(mbSlow(f.calls)).toHaveLength(2);
    expect(message).toContain('ReccoBeats: 1 tracks with features, 2 not found.');
  });

  it('tags featured artists from the same MusicBrainz lookup', async () => {
    const db = seedDb([{ id: sid('t2'), isrc: 'ISRC2', artists: [A, B] }]);
    const f = routes();
    await runEnrich(db, deps(db, f, { spotify: null }));
    expect(mbSlow(f.calls)).toEqual([`${MB}ws/2/isrc/ISRC2?fmt=json&inc=artist-credits+tags`]);
    expect(tags(db, 'musicbrainz').map((t: any) => t.tag)).toEqual(['house', 'techno']);
  });

  it('is incremental: a second run makes no requests', async () => {
    const db = seed();
    await runEnrich(db, deps(db, routes()));
    const second = routes();
    const message = await runEnrich(db, deps(db, second));
    expect(second.calls).toEqual([]);
    expect(message).toContain('ReccoBeats: nothing new.');
  });

  it('retries failed lookups after 30 days', async () => {
    const db = seed();
    await runEnrich(db, deps(db, routes()));
    const later = routes();
    await runEnrich(db, deps(db, later, { now: () => new Date(NOW.getTime() + 31 * 86_400_000) }));
    const recco = later.calls.filter((c) => c.startsWith(RECCO));
    expect(recco).toHaveLength(1);
    expect(new URL(recco[0]!).searchParams.get('ids')!.split(',').sort()).toEqual([sid('t2'), sid('t3')]);
  });

  it('sends at most 40 ids per ReccoBeats call', async () => {
    const many = Array.from({ length: 85 }, (_, i) => ({ id: sid(`bulk${i}`), artists: [A] }));
    const db = seedDb(many);
    const f = routes();
    await runEnrich(db, deps(db, f, { spotify: null }));
    const sizes = f.calls.filter((c) => c.startsWith(RECCO)).map((c) => new URL(c).searchParams.get('ids')!.split(',').length);
    expect(sizes).toEqual([40, 40, 5]);
  });

  it('stops asking Spotify for genres when they come back empty', async () => {
    const artists = Array.from({ length: 5 }, (_, i) => ({ id: sid(`ar${i}`), name: `Artist ${i}` }));
    const db = seedDb(artists.map((a, i) => ({ id: sid(`tr${i}`), artists: [a] })), { connected: true });
    const f = routes({ genres: [] });
    const message = await runEnrich(db, deps(db, f, { limits: { genreProbe: 3 } }));
    expect(f.calls.filter((c) => c.startsWith(SPOTIFY))).toHaveLength(3);
    expect(message).toContain('seems stripped');

    const again = routes({ genres: [] });
    const second = await runEnrich(db, deps(db, again, { limits: { genreProbe: 3 } }));
    expect(again.calls.filter((c) => c.startsWith(SPOTIFY))).toHaveLength(0);
    expect(second).toContain('Spotify genres: skipped');
  });

  it('skips the Spotify phase when not connected and keeps going', async () => {
    const db = seedDb([{ id: sid('t1'), isrc: 'ISRC1', artists: [A] }]);
    const message = await runEnrich(db, deps(db, routes()));
    expect(message).toContain('Spotify genres: skipped, not connected');
    expect(tags(db, 'musicbrainz')).toHaveLength(2);
  });

  it('keeps going when one source is down', async () => {
    const db = seed();
    const f = routes();
    const down = fakeFetch({ [RECCO]: () => new Response('boom', { status: 500 }) });
    const mixed = (async (input: string | URL | Request, init?: RequestInit) =>
      String(input).startsWith(RECCO) ? down.fetch(input, init) : f.fetch(input, init)) as typeof fetch;
    const message = await runEnrich(db, { ...deps(db, f), fetch: mixed });
    expect(message).toContain('ReccoBeats: 0 tracks with features, 0 not found, 1 batches failed');
    expect(features(db)).toEqual([{ track_id: sid('t2'), source: 'deezer', tempo: 99.5, key: null, mode: null, energy: null }]);
  });

  it('caps MusicBrainz lookups per run and resumes', async () => {
    const artists = Array.from({ length: 4 }, (_, i) => ({ id: sid(`mba${i}`), name: `Solo ${i}` }));
    const db = seedDb(artists.map((a, i) => ({ id: sid(`mbt${i}`), isrc: `ISRCX${i}`, artists: [a] })));
    const mbFetch = () =>
      fakeFetch({
        ...NO_LINKS,
        [RECCO]: () => ({ content: [] }),
        [DEEZER]: () => ({ error: { code: 800 } }),
        [`${MB}ws/2/isrc/`]: (u) => ({
          recordings: [{ 'artist-credit': [{ artist: { id: u.pathname, name: 'whatever', tags: [{ name: 'jazz', count: 1 }] } }] }],
        }),
      });
    const first = mbFetch();
    const msg = await runEnrich(db, deps(db, first, { spotify: null, limits: { mbMax: 3 } }));
    expect(msg).toContain('MusicBrainz: tags for 3 of 3 artists, 1 left for the next run.');
    const second = mbFetch();
    await runEnrich(db, deps(db, second, { spotify: null, limits: { mbMax: 3 } }));
    expect(mbSlow(second.calls)).toHaveLength(1);
    expect(tags(db, 'musicbrainz')).toHaveLength(4);
  });
});

describe('batched artist tags', () => {
  it('tags artists linked to Spotify in MusicBrainz with 2 requests, and skips them in the slow phase', async () => {
    const db = seed();
    const f = fakeFetch({
      [`${MB}ws/2/url`]: () => ({
        urls: [
          {
            resource: `https://open.spotify.com/artist/${A.id}`,
            relations: [{ 'target-type': 'artist', artist: { id: 'mb-a', name: 'Alpha' } }],
          },
        ],
      }),
      [`${MB}ws/2/artist/`]: (u) =>
        u.searchParams.get('query')!.startsWith('arid:')
          ? { artists: [{ id: 'mb-a', name: 'Alpha', score: 100, tags: [{ name: 'Acid House', count: 3 }] }] }
          : { artists: [] },
      [`${MB}ws/2/isrc/`]: () => ({ recordings: [] }),
      [WIKIDATA]: () => ({
        results: {
          bindings: [
            { sid: { value: B.id }, genreLabel: { value: 'techno music' } },
            { sid: { value: B.id }, genreLabel: { value: 'Q123456' } },
          ],
        },
      }),
      [RECCO]: () => ({ content: [] }),
      [DEEZER]: () => ({ error: { code: 800 } }),
    });
    const message = await runEnrich(db, deps(db, f, { spotify: null }));
    expect(tags(db, 'musicbrainz')).toEqual([{ entity_id: A.id, tag: 'acid house', weight: 1 }]);
    expect(tags(db, 'wikidata')).toEqual([{ entity_id: B.id, tag: 'techno', weight: 1 }]);
    expect(message).toContain('MusicBrainz (linked): 1 of 2 artists matched by Spotify link, 1 have tags.');
    // Alpha came from the link; only Beta (no link) goes through the per-artist lookup.
    expect(f.calls.filter((c) => c.startsWith(`${MB}ws/2/url`))).toHaveLength(1);
    expect(f.calls.filter((c) => c.includes('query=arid'))).toHaveLength(1);
    expect(f.calls.filter((c) => c.startsWith(`${MB}ws/2/isrc/`))).toEqual([`${MB}ws/2/isrc/ISRC2?fmt=json&inc=artist-credits+tags`]);
  });
});
