import { describe, expect, it } from 'vitest';
import {
  BAR_OPTIONS,
  DEFAULT_DJ_CONFIG,
  EFFECTS_OPTIONS,
  EQ_OPTIONS,
  FILTER_OPTIONS,
  LOOPING_OPTIONS,
  MIX_PRESETS,
  VOLUME_OPTIONS,
  toCamelot,
  type DjSetConfig,
  type SheetStyle,
  type TransitionSettings,
} from '@curator/shared';
import { bpmCost, keyCost, keyRelation, parseCamelot, signedTempoDelta } from './harmony.ts';
import { namePreset, suggestTransition, type TransitionEnd } from './transitions.ts';

const cam = (s: string) => parseCamelot(s);
const end = (bpm: number, camelot: string | null, energy: number | null = 0.6): TransitionEnd => ({
  bpm,
  camelot: camelot ? cam(camelot) : null,
  energy,
});
const prefs = (over: Partial<DjSetConfig['transitions']> = {}, maxBpmStepPct = 6): DjSetConfig => ({
  ...structuredClone({ ...DEFAULT_DJ_CONFIG, maxBpmStepPct }),
  transitions: { ...structuredClone(DEFAULT_DJ_CONFIG.transitions), ...over },
});

describe('harmony helpers', () => {
  it('signedTempoDelta is signed and half/double aware', () => {
    expect(signedTempoDelta(120, 126)).toBeCloseTo(0.05);
    expect(signedTempoDelta(126, 120)).toBeCloseTo(-0.0476, 3);
    expect(signedTempoDelta(170, 86)).toBeCloseTo(2 / 170);
    expect(signedTempoDelta(170, 86, false)).toBeCloseTo(-84 / 170);
  });

  it('bpmCost is 1.0 at exactly the max step and 0 for half time', () => {
    expect(bpmCost(100, 106, 6)).toBeCloseTo(1);
    expect(bpmCost(106, 100, 6)).toBeCloseTo(1);
    expect(bpmCost(85, 170, 6)).toBeCloseTo(0);
    expect(bpmCost(85, 170, 6, false)).toBeGreaterThan(10);
  });

  it('keyCost follows research 04 §6.2', () => {
    expect(keyCost(cam('8A')!, cam('8A')!)).toBe(0);
    expect(keyCost(cam('8A')!, cam('9A')!)).toBe(1);
    expect(keyCost(cam('8A')!, cam('8B')!)).toBe(1);
    expect(keyCost(cam('8A')!, cam('9B')!)).toBe(2.5);
    expect(keyCost(cam('1A')!, cam('7B')!)).toBe(4);
  });

  it('keyRelation names the move', () => {
    expect(keyRelation(cam('8A'), cam('8A'))).toBe('same');
    expect(keyRelation(cam('8A'), cam('9A'))).toBe('adjacent');
    expect(keyRelation(cam('12A'), cam('1A'))).toBe('adjacent');
    expect(keyRelation(cam('8A'), cam('8B'))).toBe('relative');
    expect(keyRelation(cam('8A'), cam('10A'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('3A'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('9B'))).toBe('energy-boost');
    expect(keyRelation(cam('8A'), cam('2A'))).toBe('clash');
    expect(keyRelation(cam('8A'), cam('5B'))).toBe('clash');
    expect(keyRelation(null, cam('5B'))).toBe('unknown');
  });

  it('parseCamelot round-trips shared toCamelot', () => {
    expect(parseCamelot('8A')).toEqual(toCamelot(9, 0));
    expect(parseCamelot('13A')).toBeNull();
    expect(parseCamelot('x')).toBeNull();
  });
});

type Row = [bars: number, volume: string, eq: string, filter: string, effects: string, looping: string] | 'No transition';
const STYLES: SheetStyle[] = ['balanced', 'smooth', 'club', 'ambient'];

// One pair per situation, and the expected settings for each Sheet Style.
const CASES: { name: string; a: TransitionEnd; b: TransitionEnd; want: Record<SheetStyle, Row> }[] = [
  {
    name: 'big clash (tempo step > 2 × max)',
    a: end(100, '8A'),
    b: end(113, '8A'),
    want: {
      balanced: [2, 'Cut in fade out', 'Quick bass cut', 'None', 'Echo 1 out end', 'None'],
      smooth: [8, 'Fade in fade out', 'Long bass cut', 'None', 'Echo 1 out end', 'None'],
      club: 'No transition',
      ambient: [2, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Echo 1 out end', 'None'],
    },
  },
  {
    name: 'soft clash (keys clash)',
    a: end(124, '8A'),
    b: end(125, '2A'),
    want: {
      balanced: [4, 'Fade in fast out', 'Quick bass cut', 'High pass filter out', 'Echo ½ out end', 'None'],
      smooth: [8, 'Fade in fast out', 'Long bass cut', 'High pass filter out', 'Echo ½ out end', 'None'],
      club: [2, 'Fade in fast out', 'Quick bass cut', 'High pass filter out', 'Echo ½ out end', 'None'],
      ambient: [4, 'Smooth crossfade', '3-band fade', 'High pass filter out', 'Echo ½ out end', 'None'],
    },
  },
  {
    name: 'build (energy +0.30)',
    a: end(124, '8A', 0.5),
    b: end(126, '9A', 0.8),
    want: {
      balanced: [8, 'Fade in cut out', 'End bass swap', 'High pass filter in', 'None', 'None'],
      smooth: [16, 'Fade in fade out', 'End bass swap', 'High pass filter in', 'Echo ½ out end', 'None'],
      club: [4, 'Fade in cut out', 'End bass swap', 'High pass filter in', 'None', '8 beat loop'],
      ambient: [16, 'Smooth crossfade', '3-band fade', 'High pass filter in', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'long blend (neighbour keys, +1.6 %)',
    a: end(124, '8A'),
    b: end(126, '9A'),
    want: {
      balanced: [8, 'Overlap', 'Center bass swap', 'None', 'None', 'None'],
      smooth: [16, 'Smooth crossfade', 'Center bass swap', 'None', 'None', 'None'],
      club: [4, 'Overlap', 'Center bass swap', 'None', 'None', 'None'],
      ambient: [16, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'lift (energy-boost key move)',
    a: end(124, '8A'),
    b: end(127, '10A'),
    want: {
      balanced: [8, 'Overlap', 'End bass swap', 'High pass filter in', 'None', 'None'],
      smooth: [16, 'Smooth crossfade', 'End bass swap', 'High pass filter in', 'None', 'None'],
      club: [4, 'Overlap', 'End bass swap', 'High pass filter in', 'None', 'None'],
      ambient: [16, 'Smooth crossfade', '3-band fade', 'High pass filter in', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'wind-down (energy −0.30)',
    a: end(124, '8A', 0.8),
    b: end(129, '8A', 0.5),
    want: {
      balanced: [8, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      smooth: [16, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      club: [4, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      ambient: [16, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'standard (neighbour keys, +4.0 %)',
    a: end(124, '8A'),
    b: end(129, '9A'),
    want: {
      balanced: [8, 'Crossfade', 'Center bass swap', 'None', 'None', 'None'],
      smooth: [16, 'Smooth crossfade', 'Center bass swap', 'None', 'None', 'None'],
      club: [4, 'Cut in fade out', 'Quick bass cut', 'None', 'None', 'None'],
      ambient: [16, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
    },
  },
];

const custom = (row: Exclude<Row, 'No transition'>) => {
  const [bars, volume, eq, filter, effects, looping] = row;
  return { preset: 'Custom', bars, volume, eq, filter, effects, looping };
};
const NULLS = { bars: null, volume: null, eq: null, filter: null, effects: null, looping: null };

describe('suggestTransition: situation × Sheet Style', () => {
  for (const c of CASES) {
    for (const style of STYLES) {
      it(`${c.name}, ${style}`, () => {
        const t = suggestTransition(c.a, c.b, prefs({ sheetStyle: style }));
        const want = c.want[style];
        expect(t.settings).toEqual(want === 'No transition' ? { preset: 'No transition', ...NULLS } : custom(want));
        expect(t.suggested).toEqual(t.settings);
        expect(t.suggested).not.toBe(t.settings);
        expect(t.applied).toBe(false);
      });
    }
  }

  it('a key clash with a tempo step over the max is a big clash', () => {
    expect(suggestTransition(end(124, '8A'), end(133, '2A'), prefs()).settings).toMatchObject({ bars: 2, volume: 'Cut in fade out' });
    expect(suggestTransition(end(124, '8A'), end(133, '8A'), prefs()).settings).toMatchObject({ bars: 4, volume: 'Fade in fast out' });
  });

  it('long blend: 16 bars for the same key within 1.5 % or when the default is 16', () => {
    expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs()).settings.bars).toBe(16);
    expect(suggestTransition(end(124, '8A'), end(126, '9A'), prefs({ defaultBars: 16 })).settings.bars).toBe(16);
    expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs({ sheetStyle: 'club' })).settings.bars).toBe(8);
  });

  it('standard mix uses the default bars, scaled by the Sheet Style', () => {
    const std = (defaultBars: 4 | 8 | 16, sheetStyle: SheetStyle) =>
      suggestTransition(end(124, '8A'), end(129, '9A'), prefs({ defaultBars, sheetStyle })).settings.bars;
    expect([std(4, 'balanced'), std(16, 'balanced')]).toEqual([4, 16]);
    expect([std(4, 'smooth'), std(16, 'smooth')]).toEqual([8, 16]);
    expect([std(4, 'club'), std(16, 'club')]).toEqual([2, 8]);
    expect(std(4, 'ambient')).toBe(16);
  });

  it('unknown key → Auto in every Sheet Style, with all values null', () => {
    for (const sheetStyle of STYLES) {
      const t = suggestTransition(end(124, null), end(125, '8A'), prefs({ sheetStyle }));
      expect(t.settings).toEqual({ preset: 'Auto', ...NULLS });
      expect(t).toMatchObject({ keyRelation: 'unknown', applied: false });
      expect(t.reason).toMatch(/^Key unknown for this track, .*leave it on Auto/);
    }
    expect(suggestTransition(end(124, null), end(125, null), prefs()).reason).toMatch(/^Key unknown for both tracks/);
  });

  it('a big tempo jump wins over an unknown key', () => {
    expect(suggestTransition(end(100, null), end(110, '8A'), prefs()).settings).toMatchObject({ preset: 'Custom', bars: 4 });
  });

  it('respects rule toggles', () => {
    const off = { longBlendWhenCompatible: false, riseOnEnergyJump: false, shortFadeOnClash: false, autoWhenUnknown: false };
    // No build, no long blend: the standard mix.
    expect(suggestTransition(end(124, '8A', 0.4), end(126, '8A', 0.8), prefs({ rules: off })).settings.volume).toBe('Crossfade');
    // A clash without the clash rule: Auto.
    expect(suggestTransition(end(124, '8A'), end(125, '2A'), prefs({ rules: off })).settings.preset).toBe('Auto');
    // Unknown key without the Auto rule: the standard mix.
    expect(suggestTransition(end(124, null), end(125, '8A'), prefs({ rules: off })).settings.preset).toBe('Custom');
  });

  it('the max tempo step decides what counts as a clash', () => {
    expect(suggestTransition(end(124, '8A'), end(129, '9A'), prefs({}, 3)).settings.bars).toBe(4);
    expect(suggestTransition(end(124, '8A'), end(129, '9A'), prefs({}, 8)).settings.volume).toBe('Crossfade');
  });

  it('half-time pair counts as a small tempo change', () => {
    const t = suggestTransition(end(170, '8A'), end(86, '8A'), prefs());
    expect(t.bpmDeltaPct).toBeCloseTo(1.2, 1);
    expect(t.settings).toMatchObject({ volume: 'Overlap', bars: 16 });
  });

  it('reason is one sentence with the evidence and the intent', () => {
    const t = suggestTransition(end(124, '8A'), end(126, '9A'), prefs());
    expect(t).toMatchObject({ keyRelation: 'adjacent', energyDelta: 0 });
    expect(t.bpmDeltaPct).toBeCloseTo(1.6, 1);
    expect(t.reason).toBe(
      'Neighbour keys (8A → 9A), tempo +1.6 %, energy 0.60 → 0.60: a long blend over 8 bars, bass swap halfway, both tracks full volume.',
    );
    expect(suggestTransition(end(100, '8A'), end(113, '8A'), prefs({ sheetStyle: 'club' })).reason).toMatch(
      /^Same key \(8A\), tempo \+13\.0 %.*No transition/,
    );
    expect(suggestTransition(end(124, '8A', 0.5), end(126, '9A', 0.8), prefs({ sheetStyle: 'club' })).reason).toMatch(
      /energy 0\.50 → 0\.80: a build over 4 bars.*loop 8 beats of this track while the next one builds\.$/,
    );
    for (const c of CASES) {
      for (const sheetStyle of STYLES) {
        const reason = suggestTransition(c.a, c.b, prefs({ sheetStyle })).reason;
        expect(reason).toMatch(/tempo [+−]\d+\.\d %/);
        expect(reason.match(/\.(\s|$)/g)).toHaveLength(1);
      }
    }
  });

  it('only uses the exact option names, and the preset shape is consistent', () => {
    const in_ = <T extends string>(list: readonly T[], v: string | null) => v === null || (list as readonly string[]).includes(v);
    const keys = ['1A', '8A', '8B', '9A', '10A', '2A', '5B', null];
    const bpms = [86, 100, 118, 124, 126, 129, 134, 140, 170];
    const energies = [null, 0.3, 0.6, 0.9];
    const ruleSets = [DEFAULT_DJ_CONFIG.transitions.rules, { longBlendWhenCompatible: false, riseOnEnergyJump: false, shortFadeOnClash: false, autoWhenUnknown: false }];
    let n = 0;
    for (const sheetStyle of STYLES)
      for (const rules of ruleSets)
        for (const ka of keys)
          for (const kb of keys)
            for (const bb of bpms)
              for (const ea of energies) {
                const s: TransitionSettings = suggestTransition(end(124, ka, ea), end(bb, kb, 0.6), prefs({ sheetStyle, rules })).settings;
                n++;
                expect(MIX_PRESETS).toContain(s.preset);
                expect(in_(VOLUME_OPTIONS, s.volume) && in_(EQ_OPTIONS, s.eq) && in_(FILTER_OPTIONS, s.filter)).toBe(true);
                expect(in_(EFFECTS_OPTIONS, s.effects) && in_(LOOPING_OPTIONS, s.looping)).toBe(true);
                const values = [s.volume, s.eq, s.filter, s.effects, s.looping];
                if (s.preset === 'Custom') {
                  expect(values.every((v) => v !== null)).toBe(true);
                  expect(BAR_OPTIONS).toContain(s.bars);
                } else {
                  expect(['Auto', 'No transition']).toContain(s.preset);
                  expect([s.bars, ...values].every((v) => v === null)).toBe(true);
                }
                if (s.preset === 'No transition') expect(sheetStyle).toBe('club');
              }
    expect(n).toBeGreaterThan(4000);
  });
});

describe('namePreset', () => {
  const s: TransitionSettings = custom([8, 'Overlap', 'Center bass swap', 'None', 'None', 'None']) as TransitionSettings;

  it('names a preset whose values match exactly and keeps the bars', () => {
    const table = { Blend: { volume: 'Overlap', eq: 'Center bass swap', filter: 'None', effects: 'None', looping: 'None' } } as const;
    expect(namePreset(s, table)).toEqual({ preset: 'Blend', ...NULLS, bars: 8 });
  });

  it('keeps Custom when nothing matches (PRESET_VALUES is empty for now)', () => {
    expect(namePreset(s)).toBe(s);
    expect(namePreset(s, { Blend: { volume: 'Crossfade', eq: 'Center bass swap', filter: 'None', effects: 'None', looping: 'None' } })).toBe(s);
  });
});
