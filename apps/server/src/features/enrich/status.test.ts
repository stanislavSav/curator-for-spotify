import { describe, expect, it } from 'vitest';
import { runEnrich } from './enrich.ts';
import { enrichStatus } from './status.ts';
import { fakeFetch, noSleep, seedDb, sid } from './test-fixtures.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const A = { id: sid('artistA'), name: 'Alpha' };
const B = { id: sid('artistB'), name: 'Beta' };

function seed() {
  return seedDb([
    { id: sid('t1'), isrc: 'ISRC1', artists: [A] }, // ReccoBeats knows it
    { id: sid('t2'), isrc: 'ISRC2', artists: [B] }, // only Deezer knows the BPM
    { id: sid('t3'), isrc: null, artists: [B] }, // unknown everywhere, no ISRC
  ]);
}

const sources = () =>
  fakeFetch({
    'https://api.reccobeats.com/': () => ({
      content: [{ id: 'x', href: `https://open.spotify.com/track/${sid('t1')}`, tempo: 120, key: 1, mode: 1, energy: 0.5 }],
    }),
    'https://api.deezer.com/': (u) => (u.pathname.endsWith('ISRC2') ? { bpm: 98 } : { error: { code: 800 } }),
    'https://musicbrainz.org/ws/2/isrc/': (u) =>
      u.pathname.endsWith('ISRC1')
        ? { recordings: [{ 'artist-credit': [{ artist: { id: 'mb-a', name: 'Alpha', tags: [{ name: 'house', count: 3 }] } }] }] }
        : { recordings: [] },
    'https://musicbrainz.org/ws/2/artist/': () => ({ artists: [] }),
  });

const run = (db: ReturnType<typeof seed>, signal?: AbortSignal) =>
  runEnrich(db, { fetch: sources().fetch, spotify: null, sleep: noSleep, now: () => NOW, signal });

describe('enrichStatus', () => {
  it('shows everything waiting before the first run', () => {
    const s = enrichStatus(seed(), NOW);
    const recco = s.sources.find((x) => x.id === 'reccobeats')!;
    expect(recco).toMatchObject({ total: 3, done: 0, notFound: 0, waiting: 3, state: 'pending' });
    expect(s.sources.find((x) => x.id === 'musicbrainz')).toMatchObject({ total: 2, waiting: 2 });
    expect(s.gaps).toMatchObject({ tracks: 3, noBpm: 3, noBpmWaiting: 3 });
  });

  it('splits found / not found / skipped after a run and explains the BPM gaps', async () => {
    const db = seed();
    await run(db);
    const s = enrichStatus(db, NOW);
    const by = Object.fromEntries(s.sources.map((x) => [x.id, x]));
    expect(by.reccobeats).toMatchObject({ done: 1, notFound: 2, waiting: 0, state: 'complete' });
    expect(by.reccobeats!.nextRetryAt).toBe('2026-11-12T12:00:00.000Z');
    expect(by.deezer).toMatchObject({ total: 2, done: 1, notFound: 0, skipped: 1, waiting: 0 });
    expect(by.musicbrainz).toMatchObject({ done: 1, notFound: 1, waiting: 0 });
    expect(s.gaps).toMatchObject({ noBpm: 1, noBpmNoIsrc: 1, noBpmWaiting: 0, noKey: 2, noTags: 2 });
  });
});

describe('Stop', () => {
  it('skips the remaining phases when the signal is aborted, and the next run continues', async () => {
    const db = seed();
    const controller = new AbortController();
    controller.abort();
    const msg = await run(db, controller.signal);
    expect(msg).toContain('ReccoBeats: not started (stopped by you');
    expect(enrichStatus(db, NOW).sources[0]!.waiting).toBe(3);
    await run(db);
    expect(enrichStatus(db, NOW).sources[0]!.waiting).toBe(0);
  });
});
