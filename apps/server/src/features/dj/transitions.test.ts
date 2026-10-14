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
import { likelyNoBeatGrid, namePreset, pairHash, setPositions, suggestTransition, type SetPosition, type TransitionEnd } from './transitions.ts';

const cam = (s: string) => parseCamelot(s);
/** Neutral track data: a beat grid, some vocals but not vocal-heavy, not acoustic. */
const end = (bpm: number, camelot: string | null, energy: number | null = 0.6, over: Partial<TransitionEnd> = {}): TransitionEnd => ({
  bpm,
  camelot: camelot ? cam(camelot) : null,
  energy,
  danceability: 0.7,
  instrumentalness: 0.3,
  acousticness: 0.1,
  tags: [],
  ...over,
});
/** Subtle by default: the situation × Sheet Style table is the pre-colour behaviour. */
const prefs = (over: Partial<DjSetConfig['transitions']> = {}, maxBpmStepPct = 6): DjSetConfig => ({
  ...structuredClone({ ...DEFAULT_DJ_CONFIG, maxBpmStepPct }),
  transitions: { ...structuredClone(DEFAULT_DJ_CONFIG.transitions), colour: 'subtle', ...over },
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
      smooth: [8, 'Fade in fade out', 'End bass swap', 'High pass filter in', 'Echo ½ out end', 'None'],
      club: [4, 'Fade in cut out', 'End bass swap', 'High pass filter in', 'None', '8 beat loop'],
      ambient: [8, 'Smooth crossfade', '3-band fade', 'High pass filter in', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'long blend (neighbour keys, +1.6 %)',
    a: end(124, '8A'),
    b: end(126, '9A'),
    want: {
      balanced: [8, 'Overlap', 'Center bass swap', 'None', 'None', 'None'],
      smooth: [8, 'Smooth crossfade', 'Center bass swap', 'None', 'None', 'None'],
      club: [4, 'Overlap', 'Center bass swap', 'None', 'None', 'None'],
      ambient: [8, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'lift (energy-boost key move)',
    a: end(124, '8A'),
    b: end(127, '10A'),
    want: {
      balanced: [8, 'Overlap', 'End bass swap', 'High pass filter in', 'None', 'None'],
      smooth: [8, 'Smooth crossfade', 'End bass swap', 'High pass filter in', 'None', 'None'],
      club: [4, 'Overlap', 'End bass swap', 'High pass filter in', 'None', 'None'],
      ambient: [8, 'Smooth crossfade', '3-band fade', 'High pass filter in', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'wind-down (energy −0.30)',
    a: end(124, '8A', 0.8),
    b: end(129, '8A', 0.5),
    want: {
      balanced: [8, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      smooth: [8, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      club: [4, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'],
      ambient: [8, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
    },
  },
  {
    name: 'standard (neighbour keys, +4.0 %)',
    a: end(124, '8A'),
    b: end(129, '9A'),
    want: {
      balanced: [8, 'Crossfade', 'Center bass swap', 'None', 'None', 'None'],
      smooth: [8, 'Smooth crossfade', 'Center bass swap', 'None', 'None', 'None'],
      club: [4, 'Cut in fade out', 'Quick bass cut', 'None', 'None', 'None'],
      ambient: [8, 'Smooth crossfade', '3-band fade', 'Low pass filter out', 'Reverb out end', 'None'],
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

  it('never suggests more than 8 bars: long blends, smooth and ambient stay at 8', () => {
    for (const sheetStyle of STYLES) {
      expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs({ sheetStyle })).settings.bars).toBeLessThanOrEqual(8);
    }
    expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs()).settings.bars).toBe(8);
    expect(suggestTransition(end(124, '8A'), end(125, '8A'), prefs({ sheetStyle: 'club' })).settings.bars).toBe(4);
  });

  it('standard mix uses the default bars, scaled by the Sheet Style', () => {
    const std = (defaultBars: 4 | 8, sheetStyle: SheetStyle) =>
      suggestTransition(end(124, '8A'), end(129, '9A'), prefs({ defaultBars, sheetStyle })).settings.bars;
    expect([std(4, 'balanced'), std(8, 'balanced')]).toEqual([4, 8]);
    expect([std(4, 'smooth'), std(8, 'smooth')]).toEqual([8, 8]);
    expect([std(4, 'club'), std(8, 'club')]).toEqual([2, 4]);
    expect(std(4, 'ambient')).toBe(8);
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
    expect(t.settings).toMatchObject({ volume: 'Overlap', bars: 8 });
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

// ---- Transition Colour, track data, position ---------------------------------

const SLOTS = ['filter', 'effects', 'looping'] as const;
const extras = (s: TransitionSettings, base: TransitionSettings) => SLOTS.filter((k) => s[k] !== base[k]);
const ids = Array.from({ length: 24 }, (_, i) => [`t${i}`, `t${i + 1}`] as const);
const withIds = (a: TransitionEnd, b: TransitionEnd, [ia, ib]: readonly [string, string]) => [{ ...a, id: ia }, { ...b, id: ib }] as const;
const MID: SetPosition = { index: 3, pairs: 10, p: 3 / 9, nearPeak: false };

describe('Transition Colour', () => {
  const a = end(124, '8A', 0.6);
  const b = end(126, '9A', 0.6);

  it('subtle keeps clean blends at Volume + EQ, even around the peak', () => {
    for (const pair of ids) {
      const [x, y] = withIds(a, b, pair);
      const s = suggestTransition(x, y, prefs({ colour: 'subtle' }), { ...MID, nearPeak: true }).settings;
      expect([s.filter, s.effects, s.looping]).toEqual(['None', 'None', 'None']);
    }
  });

  it('medium adds exactly one extra to a clean blend, and neighbouring cards vary', () => {
    const picked = new Set<string>();
    for (const pair of ids) {
      const [x, y] = withIds(a, b, pair);
      const base = suggestTransition(x, y, prefs({ colour: 'subtle' }), MID).settings;
      const t = suggestTransition(x, y, prefs({ colour: 'medium' }), MID);
      const changed = extras(t.settings, base);
      expect(changed).toHaveLength(1);
      picked.add(`${changed[0]}=${t.settings[changed[0]!]}`);
    }
    expect(picked.size).toBeGreaterThan(1);
    for (const p of picked) expect(['filter=High pass filter in', 'effects=Reverb out end', 'effects=Echo ¾ out end']).toContain(p);
  });

  it('medium: rising energy → high-pass in; falling slightly → low-pass out or a tail', () => {
    const up = suggestTransition({ ...a, id: 'x' }, { ...end(126, '9A', 0.7), id: 'y' }, prefs({ colour: 'medium' }), MID);
    expect(up.settings).toMatchObject({ filter: 'High pass filter in', effects: 'None', looping: 'None' });
    expect(up.reason).toContain('The energy holds or rises, so a high-pass filter sweeps the next track in');
    for (const pair of ids) {
      const [x, y] = withIds(end(124, '8A', 0.7), end(126, '9A', 0.62), pair);
      const s = suggestTransition(x, y, prefs({ colour: 'medium' }), MID).settings;
      expect(s.filter === 'Low pass filter out' || ['Reverb out end', 'Echo ¾ out end'].includes(s.effects!)).toBe(true);
      expect(s.filter).not.toBe('High pass filter in');
    }
  });

  it('medium: a 4-beat loop when the outgoing track is instrumental and the blend is 8 bars', () => {
    const inst = { instrumentalness: 0.8 };
    const loops = ids
      .map((pair) => suggestTransition(...withIds(end(124, '8A', 0.6, inst), end(126, '9A', 0.7), pair), prefs({ colour: 'medium' }), MID))
      .filter((t) => t.settings.looping !== 'None');
    expect(loops.length).toBeGreaterThan(0);
    for (const t of loops) {
      expect(t.settings.looping).toBe('4 beat loop');
      expect(t.reason).toContain('Instrumental outro, so a 4-beat loop holds it while the next track comes in');
    }
    // Club halves the bars to 4: no loop.
    for (const pair of ids) {
      const t = suggestTransition(...withIds(end(124, '8A', 0.6, inst), end(126, '9A', 0.7), pair), prefs({ colour: 'medium', sheetStyle: 'club' }), MID);
      expect(t.settings.looping).toBe('None');
    }
  });

  it('medium leaves clashes, builds and wind-downs alone', () => {
    for (const [x, y] of [
      [end(124, '8A'), end(125, '2A')],
      [end(124, '8A', 0.5), end(126, '9A', 0.8)],
      [end(124, '8A', 0.8), end(129, '8A', 0.5)],
    ] as const) {
      const sub = suggestTransition({ ...x, id: 'p' }, { ...y, id: 'q' }, prefs({ colour: 'subtle' }), MID).settings;
      expect(suggestTransition({ ...x, id: 'p' }, { ...y, id: 'q' }, prefs({ colour: 'medium' }), MID).settings).toEqual(sub);
    }
  });

  it('bold adds two extras: combined filters and echo or reverb tails', () => {
    for (const pair of ids) {
      const [x, y] = withIds(a, b, pair);
      const t = suggestTransition(x, y, prefs({ colour: 'bold' }), MID);
      expect(t.settings.filter).toBe('High pass filter in low pass filter out');
      expect(['Reverb out end', 'Echo 1 out end']).toContain(t.settings.effects);
    }
  });

  it('bold: 8-beat loops on instrumental outgoing tracks, and upgrades the lift filter', () => {
    const inst = { instrumentalness: 0.9 };
    const all = ids.map((pair) => suggestTransition(...withIds(end(124, '8A', 0.6, inst), end(126, '9A', 0.7), pair), prefs({ colour: 'bold' }), MID).settings);
    expect(all.every((s) => s.looping === '8 beat loop' && s.filter === 'High pass filter in low pass filter out')).toBe(true);
    const lift = suggestTransition({ ...end(124, '8A'), id: 'l1' }, { ...end(127, '10A'), id: 'l2' }, prefs({ colour: 'bold' }), MID).settings;
    expect(lift.filter).toBe('High pass filter in low pass filter out');
  });

  it('bold also colours builds and wind-downs, never clashes', () => {
    const build = suggestTransition({ ...end(124, '8A', 0.5, { instrumentalness: 0.9 }), id: 'b1' }, { ...end(126, '9A', 0.8), id: 'b2' }, prefs({ colour: 'bold' }), MID);
    expect(build.settings.looping).toBe('8 beat loop');
    const clash = suggestTransition({ ...end(124, '8A'), id: 'c1' }, { ...end(125, '2A'), id: 'c2' }, prefs({ colour: 'bold' }), MID).settings;
    expect(clash).toEqual(suggestTransition(end(124, '8A'), end(125, '2A'), prefs()).settings);
  });

  it('is deterministic: the same pair always gets the same settings and reason', () => {
    for (const colour of ['medium', 'bold'] as const) {
      for (const pair of ids) {
        const one = suggestTransition(...withIds(a, b, pair), prefs({ colour }), MID);
        const two = suggestTransition(...withIds(a, b, pair), prefs({ colour }), MID);
        expect(two).toEqual(one);
      }
    }
    expect(pairHash('a', 'b')).toBe(pairHash('a', 'b'));
    expect(pairHash('a', 'b')).not.toBe(pairHash('b', 'a'));
  });
});

describe('track data', () => {
  it('a vocal-heavy pair gets a crossfade and a 3-band fade instead of a long overlap', () => {
    const vocal = { instrumentalness: 0.05 };
    const t = suggestTransition(end(124, '8A', 0.6, vocal), end(126, '9A', 0.6, vocal), prefs());
    expect(t.settings).toMatchObject({ bars: 8, volume: 'Crossfade', eq: '3-band fade' });
    expect(t.reason).toContain('Both tracks have vocals, so a 3-band fade avoids a vocal clash.');
    // Unknown instrumentalness counts as vocal, unless tagged instrumental.
    const unknown = { instrumentalness: null };
    expect(suggestTransition(end(124, '8A', 0.6, unknown), end(126, '9A', 0.6, unknown), prefs()).settings.volume).toBe('Crossfade');
    const tagged = { instrumentalness: null, tags: ['Instrumental'] };
    expect(suggestTransition(end(124, '8A', 0.6, tagged), end(126, '9A', 0.6, unknown), prefs()).settings.volume).toBe('Overlap');
    // Only clean blends: a clash keeps its short masked mix.
    expect(suggestTransition(end(124, '8A', 0.6, vocal), end(125, '2A', 0.6, vocal), prefs()).settings.eq).toBe('Quick bass cut');
  });

  it('an instrumental outgoing track keeps the overlap', () => {
    const t = suggestTransition(end(124, '8A', 0.6, { instrumentalness: 0.7 }), end(126, '9A', 0.6, { instrumentalness: 0.05 }), prefs());
    expect(t.settings).toMatchObject({ volume: 'Overlap', eq: 'Center bass swap' });
  });

  it('an acoustic track on either side: smooth crossfade, no loops, no echoes', () => {
    const acoustic = { acousticness: 0.8 };
    for (const colour of ['subtle', 'medium', 'bold'] as const) {
      for (const pair of ids) {
        const t = suggestTransition(...withIds(end(124, '8A', 0.6, { instrumentalness: 0.9 }), end(126, '9A', 0.6, acoustic), pair), prefs({ colour }), MID);
        expect(t.settings.volume).toBe('Smooth crossfade');
        expect(t.settings.looping).toBe('None');
        expect(t.settings.effects).not.toMatch(/Echo|Delay/);
      }
    }
    const clash = suggestTransition(end(100, '8A', 0.6, acoustic), end(113, '8A'), prefs());
    expect(clash.settings.effects).toBe('Reverb out end');
    expect(clash.reason).toContain('An acoustic track, so a smooth crossfade with no loops or echoes.');
    const club = suggestTransition(end(124, '8A', 0.5), end(126, '9A', 0.8, acoustic), prefs({ sheetStyle: 'club' }));
    expect(club.settings.looping).toBe('None');
  });

  it('flags pairs where Spotify may hide the bar choice, and says so', () => {
    const hidden = (over: Partial<TransitionEnd>) => suggestTransition(end(124, '8A', 0.6, over), end(126, '9A'), prefs());
    expect(hidden({ danceability: 0.2 }).barsMayBeHidden).toBe(true);
    expect(hidden({ danceability: null, energy: 0.2 }).barsMayBeHidden).toBe(true);
    expect(hidden({ danceability: null, energy: 0.5 }).barsMayBeHidden).toBe(false);
    expect(hidden({ tags: ['modern classical'] }).barsMayBeHidden).toBe(true);
    expect(hidden({ tags: ['Drone'] }).barsMayBeHidden).toBe(true);
    expect(hidden({}).barsMayBeHidden).toBe(false);
    expect(hidden({ danceability: 0.2 }).reason).toMatch(/Spotify may show no bar choice here .*skip the bars\.$/);
    expect(hidden({}).reason).not.toMatch(/bar choice/);
    expect(likelyNoBeatGrid({ bpm: 120, camelot: null, energy: null })).toBe(false);
  });
});

describe('position in the set', () => {
  const a = end(124, '8A', 0.6);
  const b = end(126, '9A', 0.6);
  const pos = (index: number, nearPeak = false, pairs = 10): SetPosition => ({ index, pairs, p: index / (pairs - 1), nearPeak });

  it('setPositions marks the top 20 % of the target range as the peak', () => {
    const p = setPositions([0.5, 0.6, 0.7, 0.8, 0.9, 0.85, 0.6]);
    expect(p).toHaveLength(6);
    // Peak threshold 0.82: a pair is near the peak when either end's target reaches it.
    expect(p.map((x) => x.nearPeak)).toEqual([false, false, false, true, true, true]);
    expect(p[0]).toMatchObject({ index: 0, pairs: 6, p: 0 });
    expect(p[5]!.p).toBe(1);
    expect(setPositions([0.7, 0.7, 0.7]).every((x) => !x.nearPeak)).toBe(true);
    expect(setPositions([0.7])).toEqual([]);
  });

  it('the first transition stays clean at medium, one level down at bold', () => {
    const t = suggestTransition({ ...a, id: 'f1' }, { ...b, id: 'f2' }, prefs({ colour: 'medium' }), pos(0));
    expect([t.settings.filter, t.settings.effects, t.settings.looping]).toEqual(['None', 'None', 'None']);
    expect(t.reason).toContain('First transition, so the intro stays clean.');
    const bold = suggestTransition({ ...a, id: 'f1' }, { ...b, id: 'f2' }, prefs({ colour: 'bold' }), pos(0));
    const sub = suggestTransition(a, b, prefs()).settings;
    expect(extras(bold.settings, sub)).toHaveLength(1);
  });

  it('the last transition may close the set with a reverb tail', () => {
    for (const pair of ids) {
      const t = suggestTransition(...withIds(a, b, pair), prefs({ colour: 'medium' }), pos(9));
      expect(t.settings).toMatchObject({ filter: 'None', effects: 'Reverb out end', looping: 'None' });
      expect(t.reason).toContain('The set ends here, so a reverb tail rounds it off.');
    }
    expect(suggestTransition(a, b, prefs({ colour: 'subtle' }), pos(9)).settings.effects).toBe('None');
  });

  it('around the peak, medium gets one level more colour (two extras)', () => {
    for (const pair of ids) {
      const t = suggestTransition(...withIds(a, b, pair), prefs({ colour: 'medium' }), pos(5, true));
      expect(t.settings.filter).toBe('High pass filter in low pass filter out');
      expect(t.settings.effects).not.toBe('None');
      expect(t.reason).toContain('Near the peak of the set, so more colour.');
    }
  });
});

describe('every combination stays inside Spotify’s lists', () => {
  it('values, preset shape and bars ≤ 8 for all colours, styles, track data and positions', () => {
    const in_ = (list: readonly string[], v: string | null) => v === null || list.includes(v);
    const data: Partial<TransitionEnd>[] = [
      {},
      { instrumentalness: 0.05 },
      { instrumentalness: 0.9 },
      { instrumentalness: null, danceability: null, acousticness: null },
      { acousticness: 0.9 },
      { danceability: 0.1, tags: ['ambient'] },
    ];
    const positions: (SetPosition | undefined)[] = [undefined, { index: 0, pairs: 8, p: 0, nearPeak: false }, { index: 4, pairs: 8, p: 4 / 7, nearPeak: true }, { index: 7, pairs: 8, p: 1, nearPeak: false }];
    const seen = { filter: new Set<string>(), effects: new Set<string>(), looping: new Set<string>() };
    let n = 0;
    for (const colour of ['subtle', 'medium', 'bold'] as const)
      for (const sheetStyle of STYLES)
        for (const da of data)
          for (const db of data.slice(0, 3))
            for (const pos of positions)
              for (const [kb, bb, eb] of [['9A', 126, 0.6], ['8A', 125, 0.4], ['10A', 127, 0.65], ['9A', 126, 0.9], ['2A', 125, 0.6], ['8A', 113, 0.6], [null, 125, 0.6]] as const) {
                const t = suggestTransition({ ...end(124, '8A', 0.6, da), id: `a${n}` }, { ...end(bb, kb, eb, db), id: `b${n}` }, prefs({ colour, sheetStyle }), pos);
                const s = t.settings;
                n++;
                expect(MIX_PRESETS).toContain(s.preset);
                expect(in_(VOLUME_OPTIONS, s.volume) && in_(EQ_OPTIONS, s.eq) && in_(FILTER_OPTIONS, s.filter)).toBe(true);
                expect(in_(EFFECTS_OPTIONS, s.effects) && in_(LOOPING_OPTIONS, s.looping)).toBe(true);
                if (s.preset === 'Custom') {
                  expect(BAR_OPTIONS).toContain(s.bars);
                  seen.filter.add(s.filter!);
                  seen.effects.add(s.effects!);
                  seen.looping.add(s.looping!);
                }
                expect(s.bars == null || s.bars <= 8).toBe(true);
                expect(t.ai).toBeNull();
              }
    expect(n).toBeGreaterThan(2000);
    expect([...seen.looping].sort()).toEqual(['4 beat loop', '8 beat loop', 'None']);
    expect(seen.filter).toContain('High pass filter in low pass filter out');
    expect(seen.effects).toContain('Echo 1 out end');
    expect(seen.effects).toContain('Echo ¾ out end');
  });
});
