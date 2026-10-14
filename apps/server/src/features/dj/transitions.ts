import {
  PRESET_VALUES,
  type Camelot,
  type DjSetConfig,
  type DjTransition,
  type EffectsOption,
  type EqOption,
  type FilterOption,
  type LoopingOption,
  type MixPreset,
  type SheetStyle,
  type TransitionBars,
  type TransitionSettings,
  type VolumeOption,
} from '@curator/shared';
import { describeKeyMove, isCompatible, keyRelation, signedTempoDelta } from './harmony.ts';

// Rule engine for one pair (ADR 0002: advice only). "out" acts on the
// outgoing track, "in" on the incoming one. Three steps:
//   1. classify the pair into a Situation (first match wins),
//   2. look up the base Transition Settings for it in RECIPES,
//   3. let the Sheet Style transform them.

export interface TransitionEnd {
  bpm: number;
  camelot: Camelot | null;
  energy: number | null;
}

type Prefs = Pick<DjSetConfig, 'maxBpmStepPct' | 'allowHalfDouble' | 'transitions'>;

export type Situation = 'big-clash' | 'soft-clash' | 'build' | 'long-blend' | 'lift' | 'wind-down' | 'standard';

/** Custom settings: bars and all five values are set. */
export interface Recipe {
  bars: TransitionBars;
  volume: VolumeOption;
  eq: EqOption;
  filter: FilterOption;
  effects: EffectsOption;
  looping: LoopingOption;
}

const r = (bars: TransitionBars, volume: VolumeOption, eq: EqOption, filter: FilterOption, effects: EffectsOption, looping: LoopingOption): Recipe => ({
  bars,
  volume,
  eq,
  filter,
  effects,
  looping,
});

/** Base settings per Situation (Balanced Sheet Style). Long blend and standard bars are set by classify(). */
export const RECIPES: Record<Situation, Recipe> = {
  'big-clash': r(2, 'Cut in fade out', 'Quick bass cut', 'None', 'Echo 1 out end', 'None'),
  'soft-clash': r(4, 'Fade in fast out', 'Quick bass cut', 'High pass filter out', 'Echo ½ out end', 'None'),
  build: r(8, 'Fade in cut out', 'End bass swap', 'High pass filter in', 'None', 'None'),
  'long-blend': r(8, 'Overlap', 'Center bass swap', 'None', 'None', 'None'),
  lift: r(8, 'Overlap', 'End bass swap', 'High pass filter in', 'None', 'None'),
  'wind-down': r(8, 'Fade in fade out', 'Bass fade out', 'Low pass filter out', 'Reverb out end', 'None'),
  standard: r(8, 'Crossfade', 'Center bass swap', 'None', 'None', 'None'),
};

const LABEL: Record<Situation, string> = {
  'big-clash': 'a short masked mix',
  'soft-clash': 'a short masked mix',
  build: 'a build',
  'long-blend': 'a long blend',
  lift: 'a lift',
  'wind-down': 'a wind-down',
  standard: 'a standard mix',
};

const isClash = (s: Situation) => s === 'big-clash' || s === 'soft-clash';
const clampBars = (n: number, min: number, max = 16): TransitionBars => Math.min(max, Math.max(min, n)) as TransitionBars;

const HARD_CUT_VOLUME: Partial<Record<VolumeOption, VolumeOption>> = {
  'Cut in fade out': 'Fade in fade out',
  'Fade in cut out': 'Fade in fade out',
  'Center cut': 'Smooth crossfade',
};
const CUT_TO_OUT_EFFECT: Partial<Record<EffectsOption, EffectsOption>> = {
  'Reverb cut end': 'Reverb out end',
  'Delay ½ cut end': 'Echo ½ out end',
  'Delay ¾ cut end': 'Echo ¾ out end',
  'Echo ½ cut end': 'Echo ½ out end',
  'Echo ¾ cut end': 'Echo ¾ out end',
  'Echo 1 cut end': 'Echo 1 out end',
};

/** Sheet Style transforms on top of the base recipe. Null = No transition. */
const STYLE: Record<SheetStyle, (x: Recipe, s: Situation) => Recipe | null> = {
  balanced: (x) => x,
  // No hard cuts: fades instead, with an echo tail to mask the change.
  smooth: (x) => {
    const hardCut = HARD_CUT_VOLUME[x.volume];
    let volume = hardCut ?? x.volume;
    if (volume === 'Crossfade' || volume === 'Overlap') volume = 'Smooth crossfade';
    const effects = CUT_TO_OUT_EFFECT[x.effects] ?? (hardCut && x.effects === 'None' ? 'Echo ½ out end' : x.effects);
    return {
      ...x,
      bars: clampBars(x.bars * 2, 8),
      volume,
      eq: x.eq === 'Quick bass cut' ? 'Long bass cut' : x.eq,
      effects,
    };
  },
  club: (x, s) => {
    if (s === 'big-clash') return null;
    const y = { ...x, bars: clampBars(x.bars / 2, 2) };
    if (s === 'standard') return { ...y, volume: 'Cut in fade out', eq: 'Quick bass cut' };
    if (s === 'build') return { ...y, looping: '8 beat loop' };
    return y;
  },
  ambient: (x, s) => ({
    bars: isClash(s) ? x.bars : 16,
    volume: 'Smooth crossfade',
    eq: '3-band fade',
    filter: x.filter === 'None' ? 'Low pass filter out' : x.filter,
    effects: x.effects === 'None' ? 'Reverb out end' : x.effects,
    looping: x.looping,
  }),
};

export const AUTO: TransitionSettings = { preset: 'Auto', bars: null, volume: null, eq: null, filter: null, effects: null, looping: null };
const NO_TRANSITION: TransitionSettings = { ...AUTO, preset: 'No transition' };

/** Names the Mix Preset when a Custom suggestion matches its values exactly. */
export function namePreset(s: TransitionSettings, table: typeof PRESET_VALUES = PRESET_VALUES): TransitionSettings {
  if (s.preset !== 'Custom') return s;
  for (const [preset, v] of Object.entries(table) as [MixPreset, NonNullable<(typeof table)[MixPreset]>][]) {
    if (v.volume === s.volume && v.eq === s.eq && v.filter === s.filter && v.effects === s.effects && v.looping === s.looping) {
      return { ...AUTO, preset, bars: s.bars };
    }
  }
  return s;
}

// ---- reason text ------------------------------------------------------------

const VOLUME_TEXT: Record<VolumeOption, string> = {
  'Smooth crossfade': 'smooth crossfade',
  Overlap: 'both tracks full volume',
  'Fade in fade out': 'fade the next track in and this one out',
  'Cut in fade out': 'cut the next track in while this one fades out',
  'Fade in cut out': 'fade the next track in and cut this one at the end',
  'Center cut': 'cut over in the middle',
  Crossfade: 'crossfade',
  'Fade in fast out': 'fade the next track in and this one out fast',
};
const EQ_TEXT: Record<EqOption, string | null> = {
  'Center bass swap': 'bass swap halfway',
  'End bass swap': 'bass swap at the end',
  'Start bass swap': 'bass swap at the start',
  '3-band fade': 'fade all three bands',
  'Quick bass cut': 'cut the bass of this track early',
  'Long bass cut': 'cut the bass of this track slowly',
  'Start fade out': 'fade this track out from the start',
  'Bass fade out': 'fade the bass of this track out',
  None: null,
};
const FILTER_TEXT: Record<FilterOption, string | null> = {
  'Low pass filter out': 'low-pass this track out',
  'Low pass filter in': 'low-pass the next track in',
  'Low pass filter in low pass filter out': 'low-pass both tracks',
  'Low pass filter in high pass filter out': 'low-pass the next track in and high-pass this one out',
  'High pass filter out': 'high-pass this track out',
  'High pass filter in': 'high-pass the next track in',
  'High pass filter in high pass filter out': 'high-pass both tracks',
  'High pass filter in low pass filter out': 'high-pass the next track in and low-pass this one out',
  'High-pass filter half out': 'high-pass this track halfway out',
  'Noise out end': 'noise sweep at the end',
  None: null,
};
const EFFECTS_TEXT = (e: EffectsOption) => (e === 'None' ? null : `${e.split(' ')[0]!.toLowerCase()} tail on this track`);
const LOOPING_TEXT = (l: LoopingOption) => (l === 'None' ? null : `loop ${l.split(' ')[0]} beats of this track while the next one builds`);

function intent(x: Recipe): string {
  return [EQ_TEXT[x.eq], VOLUME_TEXT[x.volume], FILTER_TEXT[x.filter], EFFECTS_TEXT(x.effects), LOOPING_TEXT(x.looping)]
    .filter(Boolean)
    .join(', ');
}

const pct = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)} %`;
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---- engine -----------------------------------------------------------------

interface Pair {
  delta: number;
  absDelta: number;
  rel: DjTransition['keyRelation'];
  energyDelta: number | null;
  step: number;
}

/** First match wins. 'auto' = leave the preset on Auto. */
function classify(p: Pair, prefs: Prefs): { situation: Situation; bars?: TransitionBars } | 'auto' {
  const { rules, defaultBars } = prefs.transitions;
  const { absDelta, rel, energyDelta, step } = p;
  const keyClash = rel === 'clash';
  if (rules.shortFadeOnClash && ((keyClash && absDelta > step) || absDelta > step * 2)) return { situation: 'big-clash' };
  if (rules.shortFadeOnClash && (keyClash || absDelta > step)) return { situation: 'soft-clash' };
  if (rules.autoWhenUnknown && rel === 'unknown') return 'auto';
  if (rules.riseOnEnergyJump && energyDelta != null && energyDelta >= 0.15) return { situation: 'build' };
  if (rules.longBlendWhenCompatible && isCompatible(rel) && absDelta <= 3) {
    return { situation: 'long-blend', bars: defaultBars === 16 || (rel === 'same' && absDelta <= 1.5) ? 16 : 8 };
  }
  if (absDelta > step || keyClash) return 'auto';
  if (rel === 'energy-boost') return { situation: 'lift' };
  if (energyDelta != null && energyDelta <= -0.15) return { situation: 'wind-down' };
  return { situation: 'standard', bars: defaultBars };
}

/**
 * Suggests one Spotify Mix Transition for the pair a → b: a Mix Preset, bars
 * and the five Transition Settings, shaped by the Sheet Style.
 */
export function suggestTransition(a: TransitionEnd, b: TransitionEnd, prefs: Prefs): DjTransition {
  const delta = signedTempoDelta(a.bpm, b.bpm, prefs.allowHalfDouble) * 100;
  const rel = keyRelation(a.camelot, b.camelot);
  const energyDelta = a.energy != null && b.energy != null ? Math.round((b.energy - a.energy) * 100) / 100 : null;
  const pair: Pair = { delta, absDelta: Math.abs(delta), rel, energyDelta, step: prefs.maxBpmStepPct };

  const unknownFor = !a.camelot && !b.camelot ? 'both tracks' : !a.camelot ? 'this track' : 'the next track';
  const evidence = [
    rel === 'unknown' ? `Key unknown for ${unknownFor}` : capital(describeKeyMove(rel, a.camelot, b.camelot)),
    `tempo ${pct(delta)}`,
    a.energy != null && b.energy != null ? `energy ${a.energy.toFixed(2)} → ${b.energy.toFixed(2)}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const make = (settings: TransitionSettings, reason: string): DjTransition => ({
    settings: { ...settings },
    suggested: { ...settings },
    bpmDeltaPct: Math.round(delta * 10) / 10,
    keyRelation: rel,
    energyDelta,
    reason,
    applied: false,
  });

  const c = classify(pair, prefs);
  if (c === 'auto') {
    const why = rel === 'unknown' ? 'leave it on Auto, Spotify sees the beat grid' : 'no rule fits well, so leave it on Auto';
    return make(AUTO, `${evidence}: ${why}.`);
  }

  const base = { ...RECIPES[c.situation], ...(c.bars ? { bars: c.bars } : {}) };
  const styled = STYLE[prefs.transitions.sheetStyle](base, c.situation);
  if (!styled) return make(NO_TRANSITION, `${evidence}: too far apart to mix, so No transition (a clean cut).`);

  const settings = namePreset({ preset: 'Custom', ...styled });
  return make(settings, `${evidence}: ${LABEL[c.situation]} over ${styled.bars} bars, ${intent(styled)}.`);
}
