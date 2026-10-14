import {
  SETTING_ROWS,
  type DjSetRecord,
  type DjSetResult,
  type DjTransition,
  type DjTransitionPatch,
  type MixPreset,
  type SettingKey,
  type TransitionBars,
  type TransitionSettings,
} from '@curator/shared';

export const SETTING_KEYS: SettingKey[] = SETTING_ROWS.map((r) => r.key);

export function sameSettings(a: TransitionSettings, b: TransitionSettings): boolean {
  return a.preset === b.preset && a.bars === b.bars && SETTING_KEYS.every((k) => a[k] === b[k]);
}

/** The pair holds the AI pass's values (they may equal the rules'). */
export const fromAi = (t: DjTransition) => t.ai != null && sameSettings(t.settings, t.ai.settings);

/** The AI pass suggested something other than the rules. */
export const aiDiffers = (t: DjTransition) => t.ai != null && !sameSettings(t.ai.settings, t.suggested);

/** The user changed this pair: it matches neither the rules nor the AI pass. */
export const isEdited = (t: DjTransition) => !sameSettings(t.settings, t.suggested) && !fromAi(t);

/** Starting values when the user switches a pair to Custom and nothing better is known. */
const CUSTOM_START = {
  volume: 'Smooth crossfade',
  eq: 'Center bass swap',
  filter: 'None',
  effects: 'None',
  looping: 'None',
} as const satisfies Omit<TransitionSettings, 'preset' | 'bars'>;

const NO_ROWS = { volume: null, eq: null, filter: null, effects: null, looping: null };

/** Presets that have no length to set: Spotify picks it, or there is no overlap. */
export const presetHasBars = (p: MixPreset) => p !== 'Auto' && p !== 'No transition';

/**
 * The settings after the user picks a preset. Only Custom has explicit rows;
 * Auto, No transition and the other named presets leave them to Spotify.
 */
export function withPreset(
  current: TransitionSettings,
  preset: MixPreset,
  suggested: TransitionSettings,
  defaultBars: TransitionBars = 8,
): TransitionSettings {
  if (preset === current.preset) return current;
  if (!presetHasBars(preset)) return { preset, bars: null, ...NO_ROWS };
  const bars = current.bars ?? suggested.bars ?? defaultBars;
  if (preset !== 'Custom') return { preset, bars, ...NO_ROWS };
  const base = suggested.preset === 'Custom' ? suggested : null;
  return {
    preset,
    bars,
    volume: base?.volume ?? CUSTOM_START.volume,
    eq: base?.eq ?? CUSTOM_START.eq,
    filter: base?.filter ?? CUSTOM_START.filter,
    effects: base?.effects ?? CUSTOM_START.effects,
    looping: base?.looping ?? CUSTOM_START.looping,
  };
}

/** The preset line of a card, split so the page can highlight the name. */
export function presetLine(preset: MixPreset): { before: string; name: string; after: string } {
  switch (preset) {
    case 'Auto':
      return { before: 'Leave on ', name: 'Auto', after: ' — Spotify decides' };
    case 'No transition':
      return { before: 'Choose ', name: 'No transition', after: ' (hard cut)' };
    case 'Custom':
      return { before: 'Pick ', name: 'Custom', after: ', then set each row' };
    default:
      return { before: 'Choose ', name: preset, after: ' — values set by Spotify' };
  }
}

export const PRESET_DECIDES = '— preset decides';

export const rowValue = (s: TransitionSettings, key: SettingKey) => s[key] ?? PRESET_DECIDES;

/** "3 → 4 · 8 bars · Custom" for transitions[index]. */
export function pairTitle(index: number, s: TransitionSettings): string {
  return [`${index + 1} → ${index + 2}`, s.bars ? `${s.bars} bars` : null, s.preset].filter(Boolean).join(' · ');
}

export const pairKey = (r: DjSetResult, i: number) => `${r.tracks[i]?.id}>${r.tracks[i + 1]?.id}`;

/**
 * Moves the user's edits and the AI pass's values from the previous preview
 * onto a fresh one. They stay when the same two tracks still follow each
 * other. Lost user edits are counted, so the page can say so.
 */
export function carryEdits(
  prev: DjSetResult | null,
  next: DjSetResult,
): { result: DjSetResult; kept: number; dropped: number } {
  if (!prev) return { result: next, kept: 0, dropped: 0 };
  const carry = new Map<string, { settings: TransitionSettings; ai: DjTransition['ai']; edited: boolean }>();
  prev.transitions.forEach((t, i) => {
    const edited = isEdited(t);
    if (edited || t.ai) carry.set(pairKey(prev, i), { settings: t.settings, ai: t.ai, edited });
  });
  if (carry.size === 0) return { result: next, kept: 0, dropped: 0 };
  let kept = 0;
  const transitions = next.transitions.map((t, i) => {
    const c = carry.get(pairKey(next, i));
    if (!c) return t;
    if (c.edited) kept++;
    // A pair still on the rules takes the fresh rules; one on the AI or edited keeps its values.
    const keepSettings = c.edited || (c.ai != null && sameSettings(c.settings, c.ai.settings));
    return { ...t, ai: c.ai, settings: keepSettings ? c.settings : t.settings };
  });
  const edits = [...carry.values()].filter((c) => c.edited).length;
  return { result: { ...next, transitions }, kept, dropped: edits - kept };
}

export const appliedCount = (r: DjSetResult) => r.transitions.filter((t) => t.applied).length;

/** Applies a PATCH locally (optimistic update), keeping the summary count in step. */
export function patchRecord(record: DjSetRecord, index: number, patch: DjTransitionPatch): DjSetRecord {
  const transitions = record.result.transitions.map((t, i) =>
    i === index
      ? { ...t, ...(patch.settings ? { settings: patch.settings } : {}), ...(patch.applied != null ? { applied: patch.applied } : {}) }
      : t,
  );
  const result = { ...record.result, transitions };
  return { ...record, result, applied: appliedCount(result) };
}

/** Replaces one pair's settings in a preview result. */
export function editResult(result: DjSetResult, index: number, settings: TransitionSettings): DjSetResult {
  return { ...result, transitions: result.transitions.map((t, i) => (i === index ? { ...t, settings } : t)) };
}
