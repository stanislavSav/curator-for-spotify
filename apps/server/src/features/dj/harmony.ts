import { camelotLabel, type Camelot, type KeyRelation } from '@curator/shared';

// DJ-specific musical helpers on top of shared/music.ts (research 04 §6).

/**
 * Signed tempo change from a to b as a fraction (0.04 = 4 % faster), using the
 * half/double reading of b that is closest to a when allowed.
 */
export function signedTempoDelta(a: number, b: number, allowHalfDouble = true): number {
  const candidates = allowHalfDouble ? [b, b * 2, b / 2] : [b];
  let best = candidates[0]!;
  for (const x of candidates) if (Math.abs(x - a) < Math.abs(best - a)) best = x;
  return (best - a) / a;
}

/** Symmetric tempo cost: 1.0 means the two tracks are exactly maxStepPct apart. */
export function bpmCost(a: number, b: number, maxStepPct: number, allowHalfDouble = true): number {
  const ratios = allowHalfDouble ? [b / a, (2 * b) / a, b / (2 * a)] : [b / a];
  const best = Math.min(...ratios.map((r) => Math.abs(Math.log(r))));
  return best / Math.log(1 + maxStepPct / 100);
}

/** Harmonic cost from research 04 §6.2: relative = 1, diagonal ≈ 2.5, capped at 4. */
export function keyCost(a: Camelot, b: Camelot): number {
  const diff = Math.abs(a.number - b.number);
  const d = Math.min(diff, 12 - diff);
  const raw = a.letter === b.letter ? d : d === 0 ? 1 : d + 1.5;
  return Math.min(raw, 4);
}

export function parseCamelot(label: string | null | undefined): Camelot | null {
  const m = label ? /^(\d{1,2})([AB])$/.exec(label) : null;
  if (!m) return null;
  const number = Number(m[1]);
  return number >= 1 && number <= 12 ? { number, letter: m[2] as 'A' | 'B' } : null;
}

/** Steps clockwise from a to b on the wheel (0–11). */
const clockwise = (a: Camelot, b: Camelot) => (b.number - a.number + 12) % 12;

export function keyRelation(a: Camelot | null, b: Camelot | null): KeyRelation {
  if (!a || !b) return 'unknown';
  const cw = clockwise(a, b);
  const step = Math.min(cw, 12 - cw);
  if (a.letter === b.letter) {
    if (step === 0) return 'same';
    if (step === 1) return 'adjacent';
    // +2 and +7 are the classic "energy boost" moves.
    if (cw === 2 || cw === 7) return 'energy-boost';
    return 'clash';
  }
  if (step === 0) return 'relative';
  // Diagonal (8A → 9B): a mood change that DJs use sparingly.
  if (step === 1) return 'energy-boost';
  return 'clash';
}

export const isCompatible = (r: KeyRelation) => r === 'same' || r === 'adjacent' || r === 'relative';

export function describeKeyMove(rel: KeyRelation, a: Camelot | null, b: Camelot | null): string {
  const move = `${camelotLabel(a)} → ${camelotLabel(b)}`;
  switch (rel) {
    case 'same':
      return `same key (${camelotLabel(a)})`;
    case 'adjacent':
      return `neighbour keys (${move})`;
    case 'relative':
      return `relative major/minor (${move})`;
    case 'energy-boost':
      return `energy-boost key move (${move})`;
    case 'clash':
      return `keys clash (${move})`;
    case 'unknown':
      return 'key unknown';
  }
}
