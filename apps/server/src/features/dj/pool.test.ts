import { describe, expect, it } from 'vitest';
import type { DjLibraryFilter } from '@curator/shared';
import { openDb } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { buildCandidates, inBpmRange, matchesLibraryFilter, poolOptions, selectPool } from './pool.ts';
import { config, libTrack, seedLibrary } from './test-helpers.ts';

const filter = (over: Partial<DjLibraryFilter> = {}): DjLibraryFilter => ({
  tags: [],
  decades: [],
  bpmMin: null,
  bpmMax: null,
  energyMin: null,
  energyMax: null,
  likedOnly: false,
  ...over,
});
const none = { short_term: false, medium_term: false, long_term: false };

describe('selectPool', () => {
  const lib = [
    libTrack('p', { playlistIds: ['pl1'] }),
    libTrack('q', { playlistIds: ['pl2'] }),
    libTrack('r', { topRanks: { short_term: 3 } }),
    libTrack('s', { topRanks: { long_term: 9 }, tags: ['House'] }),
  ];

  it('unions playlists, library filter and recent favourites', () => {
    const ids = (pool: Parameters<typeof selectPool>[1]) => selectPool(lib, pool).map((t) => t.id);
    expect(ids({ playlistIds: ['pl1'], library: null, recent: none })).toEqual(['p']);
    expect(ids({ playlistIds: [], library: null, recent: { ...none, short_term: true } })).toEqual(['r']);
    expect(ids({ playlistIds: ['pl2'], library: filter({ tags: ['house'] }), recent: { ...none, short_term: true } })).toEqual([
      'q',
      'r',
      's',
    ]);
    expect(ids({ playlistIds: [], library: null, recent: none })).toEqual([]);
    expect(ids({ playlistIds: [], library: filter(), recent: none })).toHaveLength(4);
  });
});

describe('matchesLibraryFilter', () => {
  it('applies every filter', () => {
    const t = libTrack('a', { tempo: 124, energy: 0.7, tags: ['Deep House'], releaseDate: '1997-03-01', likedAt: null });
    expect(matchesLibraryFilter(t, filter({ tags: ['deep house'] }))).toBe(true);
    expect(matchesLibraryFilter(t, filter({ tags: ['techno'] }))).toBe(false);
    expect(matchesLibraryFilter(t, filter({ decades: [1990] }))).toBe(true);
    expect(matchesLibraryFilter(t, filter({ decades: [2000] }))).toBe(false);
    expect(matchesLibraryFilter(t, filter({ bpmMin: 120, bpmMax: 128 }))).toBe(true);
    expect(matchesLibraryFilter(t, filter({ bpmMin: 125 }))).toBe(false);
    expect(matchesLibraryFilter(t, filter({ energyMin: 0.8 }))).toBe(false);
    expect(matchesLibraryFilter(t, filter({ energyMax: 0.8 }))).toBe(true);
    expect(matchesLibraryFilter(t, filter({ likedOnly: true }))).toBe(false);
    expect(matchesLibraryFilter(libTrack('b', { tempo: null }), filter({ bpmMin: 100 }))).toBe(false);
  });
});

describe('inBpmRange', () => {
  it('accepts half/double tempo only when allowed', () => {
    expect(inBpmRange(85, { min: 160, max: 180 }, true)).toBe(true);
    expect(inBpmRange(85, { min: 160, max: 180 }, false)).toBe(false);
    expect(inBpmRange(85, null, false)).toBe(true);
  });
});

describe('buildCandidates', () => {
  it('skips tracks without tempo and reports the count', () => {
    const lib = [
      ...Array.from({ length: 38 }, (_, i) => libTrack(`n${i}`, { tempo: null, playlistIds: ['pl1'] })),
      libTrack('zero', { tempo: 0, playlistIds: ['pl1'] }),
      libTrack('ok', { playlistIds: ['pl1'], key: null }),
    ];
    const cfg = config({ pool: { playlistIds: ['pl1'], library: null, recent: none } });
    const { candidates, stats, warnings } = buildCandidates(lib, cfg);
    expect(candidates.map((c) => c.id)).toEqual(['ok']);
    expect(stats).toMatchObject({ total: 40, usable: 1, noTempo: 39, noKey: 1 });
    expect(warnings[0]).toBe('39 Pool tracks have no BPM and were skipped. Run Enrich to fill more.');
  });

  it('applies the BPM range, exclusions, and pulls in locked and start tracks', () => {
    const lib = [
      libTrack('in', { tempo: 124, playlistIds: ['pl1'] }),
      libTrack('fast', { tempo: 150, playlistIds: ['pl1'] }),
      libTrack('gone', { tempo: 124, playlistIds: ['pl1'] }),
      libTrack('locked', { tempo: 150 }),
      libTrack('start', { tempo: 124 }),
    ];
    const cfg = config({
      pool: { playlistIds: ['pl1'], library: null, recent: none },
      bpmRange: { min: 118, max: 130 },
      excludedTrackIds: ['gone'],
      lockedTrackIds: ['locked', 'missing'],
      startTrackId: 'start',
    });
    const { candidates, stats, warnings } = buildCandidates(lib, cfg);
    expect(candidates.map((c) => c.id)).toEqual(['in', 'locked', 'start']);
    expect(stats.outOfBpmRange).toBe(1);
    expect(warnings.join(' ')).toMatch(/1 locked or start track is not in your Library/);
    expect(candidates.find((c) => c.id === 'in')!.camelot).toEqual({ number: 8, letter: 'B' });
  });
});

describe('poolOptions', () => {
  it('summarises the Library for the form', () => {
    const db = openDb(':memory:');
    seedLibrary(db, [
      { id: 'a', tempo: 121, key: 0, mode: 1, energy: 0.5 },
      { id: 'b', tempo: 128, key: 2, mode: 0, energy: 0.8 },
      { id: 'c', tempo: null, key: 2, mode: 0, energy: 0.8 },
    ]);
    const o = poolOptions(db, getLibraryTracks(db));
    expect(o.playlists).toEqual([{ id: 'pl1', name: 'Warm-up', tracks: 3, withBpm: 2 }]);
    expect(o.bpmHistogram).toEqual([{ bpm: 120, count: 2 }]);
    expect(o.decades).toEqual([{ decade: 2010, count: 3 }]);
    expect(o.library).toMatchObject({ tracks: 3, withBpm: 2, liked: 3 });
  });
});
