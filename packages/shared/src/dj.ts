// Owned by the dj feature. Types for its API, plus the Energy Curve and the
// Transition style catalogue, which both the server and the page need.
import type { TimeRange } from './domain.ts';

// ---- config -----------------------------------------------------------------

export type CurvePreset = 'warmup-peak-cooldown' | 'steady' | 'build' | 'wave' | 'cooldown';
export type KeyStrictness = 'strict' | 'relaxed' | 'off';
export type TransitionStyle = 'Auto' | 'Fade' | 'Rise' | 'Blend';
export type TransitionBars = 2 | 4 | 8 | 16;
export type KeyRelation = 'same' | 'adjacent' | 'relative' | 'energy-boost' | 'clash' | 'unknown';

/** Filters for the "whole Library" part of the Pool. Null bounds mean "no limit". */
export interface DjLibraryFilter {
  tags: string[];
  /** Decade start years, e.g. 1990 for the 90s. */
  decades: number[];
  bpmMin: number | null;
  bpmMax: number | null;
  energyMin: number | null;
  energyMax: number | null;
  likedOnly: boolean;
}

/** The Pool is the union of the sources that are switched on. */
export interface DjPool {
  playlistIds: string[];
  /** Null = do not draw from the whole Library. */
  library: DjLibraryFilter | null;
  /** Recent favourites: the user's top tracks for each time range that is on. */
  recent: Record<TimeRange, boolean>;
}

export type DjLength = { mode: 'minutes'; minutes: number } | { mode: 'tracks'; count: number };

/** Preset curve, or custom points spread evenly from start (p = 0) to end (p = 1). */
export type DjCurve = { preset: CurvePreset } | { preset: 'custom'; points: number[] };

export interface DjTransitionRules {
  /** Compatible key and tempo within 3 % → long Blend (or Fade) with a low swap. */
  longBlendWhenCompatible: boolean;
  /** Energy rises by 0.15 or more → Rise, 8 bars. */
  riseOnEnergyJump: boolean;
  /** Key clash or tempo step above the max → short Fade, or a cut hint. */
  shortFadeOnClash: boolean;
  /** Key unknown on either side → leave it on Auto. */
  autoWhenUnknown: boolean;
}

export interface DjTransitionPrefs {
  defaultBars: 4 | 8 | 16;
  /** Styles the sheet may suggest. Auto is always allowed. */
  styles: { Fade: boolean; Rise: boolean; Blend: boolean };
  rules: DjTransitionRules;
}

export interface DjSetConfig {
  pool: DjPool;
  length: DjLength;
  curve: DjCurve;
  /** Only tracks whose BPM (or half/double, if allowed) is inside this range. */
  bpmRange: { min: number; max: number } | null;
  /** Largest tempo change between neighbours that counts as smooth, in percent. */
  maxBpmStepPct: number;
  allowHalfDouble: boolean;
  /** strict = Camelot distance ≤ 1, relaxed ≤ 2, off = ignore key. */
  keyStrictness: KeyStrictness;
  /** No artist may appear again within this many tracks. 0 = off. */
  artistSpacing: number;
  /** Optional first track. */
  startTrackId: string | null;
  /** Tracks that must be in the set. */
  lockedTrackIds: string[];
  /** Tracks the user removed; never picked. */
  excludedTrackIds: string[];
  transitions: DjTransitionPrefs;
}

export const DEFAULT_DJ_CONFIG: DjSetConfig = {
  pool: { playlistIds: [], library: null, recent: { short_term: true, medium_term: true, long_term: false } },
  length: { mode: 'minutes', minutes: 60 },
  curve: { preset: 'warmup-peak-cooldown' },
  bpmRange: null,
  maxBpmStepPct: 6,
  allowHalfDouble: true,
  keyStrictness: 'relaxed',
  artistSpacing: 3,
  startTrackId: null,
  lockedTrackIds: [],
  excludedTrackIds: [],
  transitions: {
    defaultBars: 8,
    styles: { Fade: true, Rise: true, Blend: true },
    rules: { longBlendWhenCompatible: true, riseOnEnergyJump: true, shortFadeOnClash: true, autoWhenUnknown: true },
  },
};

export const KEY_LIMIT: Record<KeyStrictness, number> = { strict: 1, relaxed: 2, off: Infinity };

// ---- Energy Curve -----------------------------------------------------------

export const CURVE_PRESETS: Record<CurvePreset, { label: string; points: number[] }> = {
  'warmup-peak-cooldown': { label: 'Warm-up → peak → cool-down', points: [0.5, 0.58, 0.68, 0.78, 0.88, 0.82, 0.6] },
  steady: { label: 'Steady', points: [0.7, 0.7] },
  build: { label: 'Build', points: [0.4, 0.9] },
  wave: { label: 'Wave', points: [0.5, 0.8, 0.55, 0.85, 0.6, 0.9, 0.65] },
  cooldown: { label: 'Cool-down', points: [0.8, 0.35] },
};

export function curvePoints(curve: DjCurve): number[] {
  const pts = curve.preset === 'custom' ? curve.points : CURVE_PRESETS[curve.preset].points;
  return pts.length > 0 ? pts : [0.7];
}

/** Target energy (0–1) at set position p (0–1), piecewise linear through the curve points. */
export function curveTarget(curve: DjCurve, p: number): number {
  const pts = curvePoints(curve);
  if (pts.length === 1) return pts[0]!;
  const x = Math.min(1, Math.max(0, p)) * (pts.length - 1);
  const i = Math.min(Math.floor(x), pts.length - 2);
  return pts[i]! + (pts[i + 1]! - pts[i]!) * (x - i);
}

// ---- Transition styles ------------------------------------------------------

/**
 * Spotify Mix presets the sheet may suggest (research 02). Only Auto, Fade and
 * Rise are named by Spotify. Blend comes from press reports. The EQ details of
 * each preset come from one third-party guide and are UNVERIFIED.
 */
export const TRANSITION_STYLES: Record<TransitionStyle, { status: 'official' | 'likely'; about: string }> = {
  Auto: {
    status: 'official',
    about: 'Spotify picks the transition from key, tempo and beat data. This is the default when you tap Mix.',
  },
  Fade: {
    status: 'official',
    about: 'Spotify preset. A standard crossfade; the bass swaps near the middle (detail UNVERIFIED).',
  },
  Rise: {
    status: 'official',
    about:
      'Spotify preset. Overlap with the bass swap at the end, a high-pass on the outgoing and a low-pass on the incoming track (detail UNVERIFIED).',
  },
  Blend: {
    status: 'likely',
    about:
      'UNVERIFIED: named by press (TechCrunch, MBW), not by Spotify. Overlap with a smooth 3-band EQ fade. If you do not see it, use Fade.',
  },
};

/** Spotify shows a bar choice only when it finds a clear beat grid. Seen values: 2, 4, 8 (12 reported). */
export const BARS_NOTE =
  'Bar lengths in Spotify are UNVERIFIED (2, 4 and 8 were seen; 12 was reported). If your length is not offered, pick the closest one.';

// ---- result -----------------------------------------------------------------

export interface DjSetTrack {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  durationMs: number;
  bpm: number;
  /** Camelot label like "8A", or null when the key is unknown. */
  camelot: string | null;
  energy: number | null;
  targetEnergy: number;
  locked: boolean;
}

export interface DjTransition {
  style: TransitionStyle;
  /** Null for Auto: Spotify decides. */
  bars: TransitionBars | null;
  /** Signed tempo change to the next track in percent, after half/double folding. */
  bpmDeltaPct: number;
  keyRelation: KeyRelation;
  /** Energy of next minus energy of this track; null when one is unknown. */
  energyDelta: number | null;
  eqHint: string | null;
  /** Big jump: a quick cut may sound better than any blend. */
  cutHint: boolean;
  reason: string;
}

export interface DjScore {
  /** 0–100, higher is smoother. */
  total: number;
  /** Share of pairs whose tempo step is within maxBpmStepPct (0–1). */
  bpmSmooth: number;
  /** Share of pairs with both keys known that are within the key limit (0–1). */
  keyCompatible: number;
  /** 1 − mean |energy − target| over tracks with known energy (0–1). */
  energyFit: number;
  /** Pairs that break the artist spacing rule. */
  artistRepeats: number;
  /** Raw path cost the optimiser minimised (lower is better). */
  cost: number;
}

export interface DjPoolStats {
  /** Tracks found in the chosen sources (after exclusions). */
  total: number;
  /** Tracks that could be used (BPM known, inside the BPM range). */
  usable: number;
  noTempo: number;
  outOfBpmRange: number;
  noKey: number;
  noEnergy: number;
}

export interface DjSetResult {
  seed: number;
  tracks: DjSetTrack[];
  /** transitions[i] goes from tracks[i] to tracks[i + 1]. */
  transitions: DjTransition[];
  score: DjScore;
  warnings: string[];
  pool: DjPoolStats;
  durationMs: number;
}

// ---- API --------------------------------------------------------------------

export interface DjPoolOptions {
  playlists: { id: string; name: string; tracks: number; withBpm: number }[];
  tags: { tag: string; count: number }[];
  decades: { decade: number; count: number }[];
  /** 10-BPM buckets: bucket 120 holds 120–129.9. */
  bpmHistogram: { bpm: number; count: number }[];
  recent: Record<TimeRange, number>;
  library: { tracks: number; withBpm: number; withKey: number; withEnergy: number; liked: number };
}

export interface DjPreviewRequest {
  config: DjSetConfig;
  seed: number;
}

export interface DjCreateRequest {
  name: string;
  config: DjSetConfig;
  result: DjSetResult;
}

export interface DjSetSummary {
  id: string;
  name: string;
  createdAt: string;
  tracks: number;
  durationMs: number;
  score: number;
  spotifyPlaylistId: string | null;
  spotifyUrl: string | null;
}

export interface DjSetRecord extends DjSetSummary {
  config: DjSetConfig;
  result: DjSetResult;
}

export const DJ_PLAYLIST_DESCRIPTION =
  "DJ Set by Spotify Curator · apply transitions in Spotify › Mix · don't use Smart Reorder";
