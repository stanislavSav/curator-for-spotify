import { CURVE_PRESETS, SHEET_STYLES, TRANSITION_COLOURS, type DjSetConfig, type KeyStrictness } from '@curator/shared';

// One-line summaries for the closed sections of the settings panel.

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function poolSummary(pool: DjSetConfig['pool'], usable: number | null): string {
  const parts: string[] = [];
  if (pool.playlistIds.length > 0) parts.push(plural(pool.playlistIds.length, 'playlist'));
  const recent = [
    pool.recent.short_term && '4-week',
    pool.recent.medium_term && '6-month',
    pool.recent.long_term && 'all-time',
  ].filter(Boolean);
  if (recent.length > 0) parts.push(`${recent.join(' + ')} favourites`);
  if (pool.library) {
    const f = pool.library;
    const filtered = f.likedOnly || f.tags.length > 0 || f.decades.length > 0 || [f.bpmMin, f.bpmMax, f.energyMin, f.energyMax].some((x) => x != null);
    parts.push(filtered ? 'Library (filtered)' : 'whole Library');
  }
  const sources = parts.length > 0 ? parts.join(' + ') : 'No sources chosen';
  return usable == null ? sources : `${sources} · ${usable} usable`;
}

export function shapeSummary(c: DjSetConfig): string {
  const length = c.length.mode === 'minutes' ? `${c.length.minutes} min` : plural(c.length.count, 'track');
  const curve = c.curve.preset === 'custom' ? 'Custom curve' : CURVE_PRESETS[c.curve.preset].label;
  return `${length} · ${curve}`;
}

export function tempoSummary(c: DjSetConfig): string {
  const range = c.bpmRange ? `${c.bpmRange.min}–${c.bpmRange.max} BPM` : 'Any BPM';
  return `${range} · step ≤ ${c.maxBpmStepPct} %`;
}

export const KEY_LABELS: Record<KeyStrictness, string> = { strict: 'Strict (≤ 1)', relaxed: 'Relaxed (≤ 2)', off: 'Off' };

export const keySummary = (c: DjSetConfig) => KEY_LABELS[c.keyStrictness];

export const transitionsSummary = (c: DjSetConfig) =>
  `${SHEET_STYLES[c.transitions.sheetStyle].label} · ${TRANSITION_COLOURS[c.transitions.colour].label} colour · ${c.transitions.defaultBars} bars`;

export function advancedSummary(c: DjSetConfig): string {
  const rules = Object.values(c.transitions.rules);
  return [
    `half/double ${c.allowHalfDouble ? 'on' : 'off'}`,
    c.artistSpacing > 0 ? `artist gap ${c.artistSpacing}` : 'no artist gap',
    `${rules.filter(Boolean).length}/${rules.length} rules`,
  ].join(' · ');
}

/** "Rebuilt just now" / "Rebuilt 3 min ago". */
export function rebuiltAgo(at: number, now: number): string {
  const min = Math.floor((now - at) / 60_000);
  return min < 1 ? 'Rebuilt just now' : `Rebuilt ${min} min ago`;
}
