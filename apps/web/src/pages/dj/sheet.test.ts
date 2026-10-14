import { describe, expect, it } from 'vitest';
import { fmtDuration, fmtEnergyDelta, fmtPct, playedBpm, sheetAsHtml, sheetAsText } from './sheet.ts';
import { AUTO, B, C, CUSTOM, resultOf, track, transition } from './test-helpers.ts';

const edited = { ...CUSTOM, filter: 'Low pass filter in high pass filter out' } as const;
const result = resultOf(
  [track('x', 'One <b>', 'X', 124, '8A'), B, C],
  [transition(CUSTOM, { settings: edited, applied: true }), transition(AUTO, { keyRelation: 'unknown' })],
);

describe('sheet as text', () => {
  const text = sheetAsText(result, 'Friday', { applied: true });

  it('lists tracks, then preset, bars and all five rows per pair', () => {
    expect(text).toContain('DJ Set: Friday (3 tracks, 10 min)');
    expect(text).toContain("'in' = incoming track, 'out' = outgoing track.");
    expect(text).toContain(' 1. X – One <b>  [124 BPM · 8A · E 0.60]');
    expect(text).toContain('    → 1 → 2 · 8 bars · Custom (edited, applied)');
    expect(text).toContain('      Pick Custom, then set each row');
    expect(text).toContain('      Volume:  Smooth crossfade');
    expect(text).toContain('      Filter:  Low pass filter in high pass filter out');
    expect(text).toContain('      Looping: None');
    expect(text).toContain('    → 2 → 3 · Auto');
    expect(text).toContain('      Leave on Auto — Spotify decides');
    expect(text).toContain('      EQ:      — preset decides');
    expect(text).toContain(' 3. Stardust – Music Sounds Better with You  [124 BPM · ? · E 0.60]');
    expect(text.match(/→ \d → \d/g)).toHaveLength(2);
  });

  it('leaves out Applied ticks for a preview', () => {
    expect(sheetAsText(result)).toContain('    → 1 → 2 · 8 bars · Custom (edited)\n');
  });
});

describe('sheet as HTML', () => {
  it('escapes names and shows preset and rows', () => {
    const html = sheetAsHtml(result, 'Fri & Sat', { applied: true });
    expect(html).toContain('One &#60;b&#62;');
    expect(html).toContain('DJ Set: Fri &#38; Sat');
    expect(html).toContain('Smart Reorder');
    expect(html).toContain('<b>Custom</b>');
    expect(html).toContain('Low pass filter in high pass filter out');
    expect(html).toContain('☑');
    expect(html).toContain('☐');
    expect(sheetAsHtml(result)).not.toContain('☑');
  });
});

describe('formatting', () => {
  it('formats numbers', () => {
    expect(fmtDuration(95 * 60_000)).toBe('1 h 35 min');
    expect(fmtPct(-2.34)).toBe('−2.3 %');
    expect(fmtPct(0)).toBe('±0.0 %');
    expect(fmtEnergyDelta(0.123)).toBe('+0.12');
  });

  it('folds half/double time for the chart', () => {
    expect(playedBpm([170, 86, 172, 120], true)).toEqual([170, 172, 172, 120]);
    expect(playedBpm([170, 86], false)).toEqual([170, 86]);
  });
});

