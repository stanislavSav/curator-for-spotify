// Musical helpers shared by the Library page, DJ ordering and the Snapshot.

const MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1] as const;
const MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10] as const;
const PITCH = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const;

export interface Camelot {
  number: number; // 1–12
  letter: 'A' | 'B'; // A = minor, B = major
}

/** Spotify-style key (pitch class 0–11) + mode (1 major, 0 minor) → Camelot. */
export function toCamelot(key: number | null | undefined, mode: number | null | undefined): Camelot | null {
  if (key == null || mode == null || key < 0 || key > 11) return null;
  return mode === 1 ? { number: MAJOR[key]!, letter: 'B' } : { number: MINOR[key]!, letter: 'A' };
}

export const camelotLabel = (c: Camelot | null) => (c ? `${c.number}${c.letter}` : '—');

export function keyName(key: number | null | undefined, mode: number | null | undefined): string {
  if (key == null || mode == null || key < 0 || key > 11) return '—';
  return `${PITCH[key]}${mode === 1 ? '' : 'm'}`;
}

/**
 * Harmonic distance on the Camelot wheel. 0 = same key, 1 = adjacent number or
 * relative major/minor (both "compatible"), higher = clashier.
 */
export function camelotDistance(a: Camelot, b: Camelot): number {
  const diff = Math.abs(a.number - b.number);
  const step = Math.min(diff, 12 - diff);
  return step + (a.letter === b.letter ? 0 : 1);
}

/** Tempo ratio distance allowing half/double time. Returns relative delta, e.g. 0.04 = 4 %. */
export function tempoDelta(a: number, b: number, allowHalfDouble = true): number {
  const candidates = allowHalfDouble ? [b, b * 2, b / 2] : [b];
  return Math.min(...candidates.map((x) => Math.abs(x - a) / a));
}
