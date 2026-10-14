import { describe, expect, it } from 'vitest';
import { DEFAULT_DJ_CONFIG, type DjSetConfig } from '@curator/shared';
import { advancedSummary, keySummary, poolSummary, rebuiltAgo, shapeSummary, tempoSummary, transitionsSummary } from './summaries.ts';

const c: DjSetConfig = structuredClone(DEFAULT_DJ_CONFIG);

describe('section summaries', () => {
  it('summarises the Pool', () => {
    const pool = { ...c.pool, playlistIds: ['p1', 'p2', 'p3'], recent: { short_term: false, medium_term: true, long_term: false } };
    expect(poolSummary(pool, 214)).toBe('3 playlists + 6-month favourites · 214 usable');
    expect(poolSummary({ ...pool, playlistIds: ['p1'] }, null)).toBe('1 playlist + 6-month favourites');
    expect(poolSummary({ playlistIds: [], library: null, recent: { short_term: false, medium_term: false, long_term: false } }, 0)).toBe(
      'No sources chosen · 0 usable',
    );
    const lib = { tags: [], decades: [], bpmMin: null, bpmMax: null, energyMin: null, energyMax: null, likedOnly: false };
    expect(poolSummary({ ...pool, playlistIds: [], library: lib }, null)).toBe('6-month favourites + whole Library');
    expect(poolSummary({ ...pool, playlistIds: [], library: { ...lib, likedOnly: true } }, null)).toContain('Library (filtered)');
  });

  it('summarises shape, tempo, key, transitions and advanced', () => {
    expect(shapeSummary(c)).toBe('60 min · Warm-up → peak → cool-down');
    expect(shapeSummary({ ...c, length: { mode: 'tracks', count: 20 }, curve: { preset: 'custom', points: [0.5] } })).toBe('20 tracks · Custom curve');
    expect(tempoSummary(c)).toBe('Any BPM · step ≤ 6 %');
    expect(tempoSummary({ ...c, bpmRange: { min: 118, max: 128 } })).toBe('118–128 BPM · step ≤ 6 %');
    expect(keySummary(c)).toBe('Relaxed (≤ 2)');
    expect(transitionsSummary(c)).toBe('Balanced · 8 bars');
    expect(advancedSummary(c)).toBe('half/double on · artist gap 3 · 4/4 rules');
  });

  it('says when the preview was rebuilt', () => {
    expect(rebuiltAgo(1_000, 30_000)).toBe('Rebuilt just now');
    expect(rebuiltAgo(0, 3 * 60_000 + 5)).toBe('Rebuilt 3 min ago');
  });
});
