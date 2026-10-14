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
  type TransitionColour,
  type TransitionSettings,
  type VolumeOption,
} from '@curator/shared';
import { describeKeyMove, isCompatible, keyRelation, signedTempoDelta } from './harmony.ts';

// Rule engine for one pair (ADR 0002: advice only). "out" acts on the
// outgoing track, "in" on the incoming one. Five steps:
//   1. classify the pair into a Situation (first match wins),
//   2. look up the base Transition Settings for it in RECIPES,
//   3. let the Sheet Style transform them,
//   4. adjust them to the tracks (TRACK_RULES: vocals, acoustic),
//   5. add Transition Colour (EXTRAS: filters, tails, loops) to blends.
// Everything is deterministic: where two extras fit equally well, a stable
// hash of the two track ids picks one, so neighbouring cards vary.

export interface TransitionEnd {
  id?: string;
  bpm: number;
  camelot: Camelot | null;
  energy: number | null;
  danceability?: number | null;
  instrumentalness?: number | null;
  acousticness?: number | null;
  tags?: string[];
}

/** Where a pair sits in the set. Without it, the engine ignores position. */
export interface SetPosition {
  index: number;
  pairs: number;
  /** index / (pairs − 1), 0 for a single pair. */
  p: number;
  /** The curve target is in the top 20 % of the set's target range. */
  nearPeak: boolean;
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

/** Base settings per Situation (Balanced Sheet Style). Standard bars are set by classify(). */
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
/** Spotify offers 2, 4, 8, and for some tracks 16 bars. */
const clampBars = (n: number, min: TransitionBars, max: TransitionBars = 16): TransitionBars =>
  Math.min(max, Math.max(min, n)) as TransitionBars;

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
  // No hard cuts: fades instead, with an echo tail to mask the change. Long: 8–16 bars.
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

// ---- track data -------------------------------------------------------------

const NO_GRID_TAGS = ['ambient', 'drone', 'classical', 'modern classical', 'new age'];
const hasTag = (t: TransitionEnd, wanted: string[]) => (t.tags ?? []).some((x) => wanted.includes(x.toLowerCase()));

/** Spotify likely finds no clear beat grid, so it may hide the bar choice. */
export function likelyNoBeatGrid(t: TransitionEnd): boolean {
  if (t.danceability != null ? t.danceability < 0.35 : t.energy != null && t.energy < 0.25) return true;
  return hasTag(t, NO_GRID_TAGS);
}
/** Unknown instrumentalness counts as vocal unless the track is tagged instrumental. */
const hasVocals = (t: TransitionEnd) => (t.instrumentalness != null ? t.instrumentalness < 0.2 : !hasTag(t, ['instrumental']));
const isInstrumental = (t: TransitionEnd) => (t.instrumentalness != null ? t.instrumentalness >= 0.5 : hasTag(t, ['instrumental']));
const isAcoustic = (t: TransitionEnd) => (t.acousticness ?? 0) >= 0.6;

interface Facts {
  situation: Situation;
  energyDelta: number | null;
  /** Both tracks have vocals. */
  vocalPair: boolean;
  instrumentalOut: boolean;
  /** Either track is acoustic. */
  acoustic: boolean;
}

/** Clean blends: the situations whose recipes are only Volume + EQ (plus the lift's filter). */
const CLEAN = new Set<Situation>(['long-blend', 'standard', 'lift']);
const LONG_OVERLAP = new Set<VolumeOption>(['Overlap', 'Crossfade', 'Smooth crossfade']);
const isEcho = (e: EffectsOption) => e.startsWith('Echo') || e.startsWith('Delay');

interface TrackRule {
  when: (f: Facts, x: Recipe) => boolean;
  apply: (x: Recipe) => Recipe;
  note: string;
}

/** Applied in order after the Sheet Style; a note is added only when the rule changed something. */
const TRACK_RULES: TrackRule[] = [
  {
    when: (f, x) => f.vocalPair && CLEAN.has(f.situation) && LONG_OVERLAP.has(x.volume),
    apply: (x) => ({ ...x, bars: clampBars(x.bars, 2), volume: x.volume === 'Overlap' ? 'Crossfade' : x.volume, eq: '3-band fade' }),
    note: 'both tracks have vocals, so a 3-band fade avoids a vocal clash',
  },
  {
    when: (f) => f.acoustic,
    apply: (x) => ({
      ...x,
      volume: x.volume === 'Overlap' || x.volume === 'Crossfade' ? 'Smooth crossfade' : x.volume,
      effects: isEcho(x.effects) ? 'Reverb out end' : x.effects,
      looping: 'None',
    }),
    note: 'an acoustic track, so a smooth crossfade with no loops or echoes',
  },
];

// ---- Transition Colour --------------------------------------------------------

type Level = 0 | 1 | 2;
type Slot = 'filter' | 'effects' | 'looping';

interface Extra {
  slot: Slot;
  /** Value per colour level (1 = medium, 2 = bold). */
  value: Record<1 | 2, Recipe[Slot]>;
  when: (f: Facts, x: Recipe) => boolean;
  /** The slot may hold this value already; the extra then upgrades it. */
  upgrades?: Recipe[Slot];
  note: Record<1 | 2, string>;
}

/** The menu of colour extras. A pair gets one (medium) or two (bold) that fit, in different slots. */
const EXTRAS: Extra[] = [
  {
    slot: 'filter',
    value: { 1: 'High pass filter in', 2: 'High pass filter in low pass filter out' },
    when: (f) => f.energyDelta == null || f.energyDelta >= 0,
    upgrades: 'High pass filter in',
    note: {
      1: 'the energy holds or rises, so a high-pass filter sweeps the next track in',
      2: 'the energy holds or rises, so a high-pass filter sweeps the next track in while a low-pass takes this one out',
    },
  },
  {
    slot: 'filter',
    value: { 1: 'Low pass filter out', 2: 'Low pass filter out' },
    when: (f) => f.energyDelta != null && f.energyDelta < 0,
    note: { 1: 'the energy dips a little, so a low-pass filter takes this track out', 2: 'the energy dips a little, so a low-pass filter takes this track out' },
  },
  {
    slot: 'effects',
    value: { 1: 'Reverb out end', 2: 'Reverb out end' },
    when: (f) => f.energyDelta == null || f.energyDelta <= 0.05,
    note: { 1: 'the phrase ends here, so a reverb tail closes it', 2: 'the phrase ends here, so a reverb tail closes it' },
  },
  {
    slot: 'effects',
    value: { 1: 'Echo ¾ out end', 2: 'Echo 1 out end' },
    when: (f) => !f.acoustic && (f.energyDelta == null || f.energyDelta <= 0.05),
    note: { 1: 'the phrase ends here, so an echo tail closes it', 2: 'the phrase ends here, so a long echo tail closes it' },
  },
  {
    slot: 'looping',
    value: { 1: '4 beat loop', 2: '8 beat loop' },
    when: (f, x) => f.instrumentalOut && !f.acoustic && x.bars >= 8,
    note: {
      1: 'instrumental outro, so a 4-beat loop holds it while the next track comes in',
      2: 'instrumental outro, so an 8-beat loop holds it while the next track comes in',
    },
  },
];

/** Situations that take colour extras, per level. Clashes never do: they are masked already. */
const COLOURED: Record<1 | 2, Set<Situation>> = {
  1: CLEAN,
  2: new Set<Situation>([...CLEAN, 'build', 'wind-down']),
};

const BASE_LEVEL: Record<TransitionColour, Level> = { subtle: 0, medium: 1, bold: 2 };

/** Colour level for one pair: +1 around the peak, −1 for the first and last transition. Subtle stays 0. */
function colourLevel(colour: TransitionColour, pos: SetPosition | undefined): { level: Level; notes: string[] } {
  const base = BASE_LEVEL[colour];
  if (base === 0 || !pos) return { level: base, notes: [] };
  const notes: string[] = [];
  let level: number = base;
  const first = pos.index === 0;
  const last = pos.index === pos.pairs - 1;
  if (pos.nearPeak && !first && !last) {
    level++;
    if (base < 2) notes.push('near the peak of the set, so more colour');
  }
  if (first || last) {
    level--;
    if (first) notes.push('first transition, so the intro stays clean');
  }
  return { level: Math.min(2, Math.max(0, level)) as Level, notes };
}

/** FNV-1a: a stable 32-bit hash, so the same pair always gets the same extras. */
export function pairHash(a: string, b: string): number {
  let h = 0x811c9dc5;
  for (const ch of `${a}>${b}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function addColour(x: Recipe, f: Facts, level: Level, hash: number): { recipe: Recipe; notes: string[] } {
  if (level === 0 || !COLOURED[level].has(f.situation)) return { recipe: x, notes: [] };
  const fits = EXTRAS.filter((e) => e.when(f, x) && (x[e.slot] === 'None' || (level === 2 && x[e.slot] === e.upgrades)));
  const start = fits.length ? hash % fits.length : 0;
  const rotated = [...fits.slice(start), ...fits.slice(0, start)];
  let recipe = x;
  const notes: string[] = [];
  const used = new Set<Slot>();
  for (const e of rotated) {
    if (used.size >= level || used.has(e.slot)) continue;
    used.add(e.slot);
    recipe = { ...recipe, [e.slot]: e.value[level] };
    notes.push(e.note[level]);
  }
  return { recipe, notes };
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
const sentences = (notes: string[]) => notes.map((n) => ` ${capital(n)}.`).join('');

export const BARS_HIDDEN_NOTE = 'Spotify may show no bar choice here (no clear beat), then skip the bars';

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
  // Same key and nearly the same tempo: the longest blend Spotify may offer (16 bars, not for every track).
  if (rules.longBlendWhenCompatible && isCompatible(rel) && absDelta <= 3)
    return { situation: 'long-blend', bars: rel === 'same' && absDelta <= 1.5 ? 16 : clampBars(defaultBars, 8) };
  if (absDelta > step || keyClash) return 'auto';
  if (rel === 'energy-boost') return { situation: 'lift' };
  if (energyDelta != null && energyDelta <= -0.15) return { situation: 'wind-down' };
  return { situation: 'standard', bars: clampBars(defaultBars, 4) };
}

/**
 * Suggests one Spotify Mix Transition for the pair a → b: a Mix Preset, bars
 * and the five Transition Settings, shaped by the Sheet Style, the tracks'
 * audio features, the Transition Colour and (when given) the pair's position.
 */
export function suggestTransition(a: TransitionEnd, b: TransitionEnd, prefs: Prefs, pos?: SetPosition): DjTransition {
  const delta = signedTempoDelta(a.bpm, b.bpm, prefs.allowHalfDouble) * 100;
  const rel = keyRelation(a.camelot, b.camelot);
  const energyDelta = a.energy != null && b.energy != null ? Math.round((b.energy - a.energy) * 100) / 100 : null;
  const pair: Pair = { delta, absDelta: Math.abs(delta), rel, energyDelta, step: prefs.maxBpmStepPct };
  const barsMayBeHidden = likelyNoBeatGrid(a) || likelyNoBeatGrid(b);

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
    reason: barsMayBeHidden && settings.bars != null ? `${reason}${sentences([BARS_HIDDEN_NOTE])}` : reason,
    barsMayBeHidden,
    ai: null,
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

  const facts: Facts = {
    situation: c.situation,
    energyDelta,
    vocalPair: hasVocals(a) && hasVocals(b),
    instrumentalOut: isInstrumental(a),
    acoustic: isAcoustic(a) || isAcoustic(b),
  };

  let recipe = styled;
  const notes: string[] = [];
  for (const rule of TRACK_RULES) {
    if (!rule.when(facts, recipe)) continue;
    const next = rule.apply(recipe);
    if (JSON.stringify(next) === JSON.stringify(recipe)) continue;
    recipe = next;
    notes.push(rule.note);
  }

  const { level, notes: positionNotes } = colourLevel(prefs.transitions.colour, pos);
  const coloured = addColour(recipe, facts, level, pairHash(a.id ?? '', b.id ?? ''));
  recipe = coloured.recipe;
  const blend = COLOURED[2].has(c.situation);
  notes.push(...positionNotes.filter((n) => blend && (!n.startsWith('near') || coloured.notes.length)), ...coloured.notes);

  // The very last transition stays clean, but may close the set with a reverb tail.
  const isLast = pos != null && pos.index === pos.pairs - 1;
  if (isLast && prefs.transitions.colour !== 'subtle' && blend) {
    if (recipe.effects === 'None') {
      recipe = { ...recipe, effects: 'Reverb out end' };
      notes.push('the set ends here, so a reverb tail rounds it off');
    } else if (!coloured.notes.length) notes.push('last transition, so the outro stays clean');
  }

  const settings = namePreset({ preset: 'Custom', ...recipe });
  return make(settings, `${evidence}: ${LABEL[c.situation]} over ${recipe.bars} bars, ${intent(recipe)}.${sentences(notes)}`);
}

/** Positions of every pair in a set, from the tracks' curve targets. */
export function setPositions(targets: number[]): SetPosition[] {
  const pairs = Math.max(0, targets.length - 1);
  if (pairs === 0) return [];
  const max = Math.max(...targets);
  const min = Math.min(...targets);
  const flat = max - min < 0.05;
  return Array.from({ length: pairs }, (_, i) => ({
    index: i,
    pairs,
    p: pairs > 1 ? i / (pairs - 1) : 0,
    nearPeak: !flat && Math.max(targets[i]!, targets[i + 1]!) >= max - 0.2 * (max - min),
  }));
}
