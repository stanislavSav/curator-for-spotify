import { describe, expect, it } from 'vitest';
import type { DjSetResult } from '@curator/shared';
import { fmtDuration, fmtPct, playedBpm, sheetAsHtml, sheetAsText } from './sheet.ts';

const result: DjSetResult = {
  seed: 1,
  tracks: [
    { id: 'a', uri: 'spotify:track:a', name: 'One <b>', artists: ['X'], durationMs: 180_000, bpm: 124, camelot: '8A', energy: 0.5, targetEnergy: 0.5, locked: false },
    { id: 'b', uri: 'spotify:track:b', name: 'Two', artists: ['Y', 'Z'], durationMs: 200_000, bpm: 125, camelot: null, energy: null, targetEnergy: 0.6, locked: true },
  ],
  transitions: [
    { style: 'Blend', bars: 16, bpmDeltaPct: 0.8, keyRelation: 'same', energyDelta: null, eqHint: 'Swap the lows halfway through.', cutHint: false, reason: 'Same key.' },
  ],
  score: { total: 90, bpmSmooth: 1, keyCompatible: 1, energyFit: 0.9, artistRepeats: 0, cost: 1 },
  warnings: [],
  pool: { total: 2, usable: 2, noTempo: 0, outOfBpmRange: 0, noKey: 1, noEnergy: 1 },
  durationMs: 380_000,
};

describe('sheet export', () => {
  it('formats text with one transition line per pair', () => {
    const text = sheetAsText(result, 'Friday');
    expect(text).toContain('DJ Set: Friday (2 tracks, 6 min)');
    expect(text).toContain(' 1. X – One <b>  [124 BPM · 8A · E 0.50]');
    expect(text).toContain('    → Blend, 16 bars · Swap the lows halfway through.');
    expect(text).toContain(' 2. Y, Z – Two  [125 BPM · ? · E ?]');
    expect(text.split('→')).toHaveLength(2);
  });

  it('escapes HTML in the print view', () => {
    const html = sheetAsHtml(result, 'Fri & Sat');
    expect(html).toContain('One &#60;b&#62;');
    expect(html).toContain('DJ Set: Fri &#38; Sat');
    expect(html).toContain("Smart Reorder");
  });

  it('formats numbers', () => {
    expect(fmtDuration(95 * 60_000)).toBe('1 h 35 min');
    expect(fmtPct(-2.34)).toBe('−2.3 %');
    expect(fmtPct(0)).toBe('±0.0 %');
  });

  it('folds half/double time for the chart', () => {
    expect(playedBpm([170, 86, 172, 120], true)).toEqual([170, 172, 172, 120]);
    expect(playedBpm([170, 86], false)).toEqual([170, 86]);
  });
});
