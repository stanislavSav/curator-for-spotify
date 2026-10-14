// Owned by the dj feature. Types for its API, plus the Energy Curve and the
// Transition style catalogue, which both the server and the page need.
import type { TimeRange } from './domain.ts';

// ---- config -----------------------------------------------------------------

export type CurvePreset = 'warmup-peak-cooldown' | 'steady' | 'build' | 'wave' | 'cooldown';
export type KeyStrictness = 'strict' | 'relaxed' | 'off';
/** Spotify offers at most 8 bars, and hides the choice when it finds no clear beat grid. */
export type TransitionBars = 2 | 4 | 8;

/** How much colour (filters, effects, loops) the sheet adds to clean blends. */
export type TransitionColour = 'subtle' | 'medium' | 'bold';
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
  /** Compatible key and tempo within 3 % → long blend with a bass swap. */
  longBlendWhenCompatible: boolean;
  /** Energy rises by 0.15 or more → a build (high-pass in, bass swap at the end). */
  riseOnEnergyJump: boolean;
  /** Key clash or tempo step above the max → short and masked (echo out), or No transition when it is big. */
  shortFadeOnClash: boolean;
  /** Key unknown on either side → leave it on Auto. */
  autoWhenUnknown: boolean;
}

export interface DjTransitionPrefs {
  /** The flavour of the whole Transition Sheet. */
  sheetStyle: SheetStyle;
  /** subtle = only what a pair needs; medium/bold add filters, effects and loops to clean blends. */
  colour: TransitionColour;
  defaultBars: 4 | 8;
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
    sheetStyle: 'balanced',
    colour: 'medium',
    defaultBars: 8,
    rules: { longBlendWhenCompatible: true, riseOnEnergyJump: true, shortFadeOnClash: true, autoWhenUnknown: true },
  },
};

/**
 * Fills a stored or partial config (older versions, localStorage) up to the
 * current shape. Unknown keys are dropped; missing ones take the defaults.
 */
export function normaliseDjConfig(raw: unknown): DjSetConfig {
  type RawPrefs = Partial<Omit<DjTransitionPrefs, 'rules'>> & { rules?: Partial<DjTransitionRules> };
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Omit<DjSetConfig, 'transitions'>> & {
    transitions?: RawPrefs;
  };
  const d = DEFAULT_DJ_CONFIG;
  const t: RawPrefs = r.transitions ?? {};
  return {
    pool: r.pool ? { ...d.pool, ...r.pool, recent: { ...d.pool.recent, ...r.pool.recent } } : d.pool,
    length: r.length ?? d.length,
    curve: r.curve ?? d.curve,
    bpmRange: r.bpmRange === undefined ? d.bpmRange : r.bpmRange,
    maxBpmStepPct: r.maxBpmStepPct ?? d.maxBpmStepPct,
    allowHalfDouble: r.allowHalfDouble ?? d.allowHalfDouble,
    keyStrictness: r.keyStrictness ?? d.keyStrictness,
    artistSpacing: r.artistSpacing ?? d.artistSpacing,
    startTrackId: r.startTrackId ?? null,
    lockedTrackIds: r.lockedTrackIds ?? [],
    excludedTrackIds: r.excludedTrackIds ?? [],
    transitions: {
      sheetStyle: t.sheetStyle && t.sheetStyle in SHEET_STYLES ? t.sheetStyle : d.transitions.sheetStyle,
      colour: t.colour && t.colour in TRANSITION_COLOURS ? t.colour : d.transitions.colour,
      // Older configs allowed 16; Spotify's maximum is 8.
      defaultBars: t.defaultBars === 4 ? 4 : 8,
      rules: { ...d.transitions.rules, ...t.rules },
    },
  };
}

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

// ---- Spotify Mix transition settings ----------------------------------------
// Option names are copied exactly from Spotify's "Edit transition" panel
// (desktop, 2026-10), so the user can match them by eye. "in" acts on the
// incoming track, "out" on the outgoing one. Lists may grow; see
// docs/tasks/006-dj-transitions.

/** Spotify's Mix presets, in the order the editor shows them. */
export const MIX_PRESETS = [
  'Custom',
  'Auto',
  'Fade',
  'Rise',
  'Blend',
  'Wave',
  'Melt',
  'Slam',
  'Dissolve',
  'Surge',
  'Afterglow',
  'No transition',
] as const;
export type MixPreset = (typeof MIX_PRESETS)[number];

export const VOLUME_OPTIONS = [
  'Smooth crossfade',
  'Overlap',
  'Fade in fade out',
  'Cut in fade out',
  'Fade in cut out',
  'Center cut',
  'Crossfade',
  'Fade in fast out',
] as const;
export type VolumeOption = (typeof VOLUME_OPTIONS)[number];

export const EQ_OPTIONS = [
  'Center bass swap',
  'End bass swap',
  'Start bass swap',
  '3-band fade',
  'Quick bass cut',
  'Long bass cut',
  'Start fade out',
  'Bass fade out',
  'None',
] as const;
export type EqOption = (typeof EQ_OPTIONS)[number];

export const FILTER_OPTIONS = [
  'Low pass filter out',
  'Low pass filter in',
  'Low pass filter in low pass filter out',
  'Low pass filter in high pass filter out',
  'High pass filter out',
  'High pass filter in',
  'High pass filter in high pass filter out',
  'High pass filter in low pass filter out',
  'High-pass filter half out',
  'Noise out end',
  'None',
] as const;
export type FilterOption = (typeof FILTER_OPTIONS)[number];

export const EFFECTS_OPTIONS = [
  'Reverb out center',
  'Reverb cut end',
  'Reverb out end',
  'Delay ½ cut end',
  'Delay ¾ cut end',
  'Echo ½ cut end',
  'Echo ½ out end',
  'Echo ¾ cut end',
  'Echo ¾ out end',
  'Echo 1 cut end',
  'Echo 1 out end',
  'None',
] as const;
export type EffectsOption = (typeof EFFECTS_OPTIONS)[number];

export const LOOPING_OPTIONS = ['1 beat loop', '2 beat loop', '4 beat loop', '8 beat loop', '16 beat loop', 'None'] as const;
export type LoopingOption = (typeof LOOPING_OPTIONS)[number];

export const BAR_OPTIONS: TransitionBars[] = [2, 4, 8];

/** Clamps any stored bar value to what Spotify offers. */
export const toBars = (n: number | null | undefined): TransitionBars | null =>
  n == null ? null : n <= 2 ? 2 : n <= 4 ? 4 : 8;

/**
 * The values to set in Spotify for one pair. With preset Custom all five
 * settings are given. With Auto, No transition or another named preset they
 * are null: the preset decides.
 */
export interface TransitionSettings {
  preset: MixPreset;
  bars: TransitionBars | null;
  volume: VolumeOption | null;
  eq: EqOption | null;
  filter: FilterOption | null;
  effects: EffectsOption | null;
  looping: LoopingOption | null;
}

/** The five rows of Spotify's editor, with its colours. */
export const SETTING_ROWS = [
  { key: 'volume', label: 'Volume', color: '#4aa3ff', options: VOLUME_OPTIONS },
  { key: 'eq', label: 'EQ', color: '#f5c518', options: EQ_OPTIONS },
  { key: 'filter', label: 'Filter', color: '#e879f9', options: FILTER_OPTIONS },
  { key: 'effects', label: 'Effects', color: '#e4e4e7', options: EFFECTS_OPTIONS },
  { key: 'looping', label: 'Looping', color: '#fb923c', options: LOOPING_OPTIONS },
] as const;
export type SettingKey = (typeof SETTING_ROWS)[number]['key'];

/**
 * What a named preset sets, once someone has looked it up in Spotify. Empty
 * until then: the sheet suggests Custom with explicit values. When a Custom
 * suggestion matches an entry here exactly, the sheet can name the preset.
 */
export const PRESET_VALUES: Partial<Record<MixPreset, Omit<TransitionSettings, 'preset' | 'bars'>>> = {};

/** Sheet Style: the flavour of the whole Transition Sheet. */
export type SheetStyle = 'balanced' | 'smooth' | 'club' | 'ambient';

export const TRANSITION_COLOURS: Record<TransitionColour, { label: string; about: string }> = {
  subtle: { label: 'Subtle', about: 'Only what a pair needs: clean blends stay Volume + EQ.' },
  medium: { label: 'Medium', about: 'Adds a filter sweep or a reverb tail to some clean blends, and loops on instrumental tracks.' },
  bold: { label: 'Bold', about: 'Filters, echoes and loops on most blends, strongest around the peak of the set.' },
};

export const SHEET_STYLES: Record<SheetStyle, { label: string; about: string }> = {
  balanced: { label: 'Balanced', about: 'Bass swaps and clean crossfades; short and masked when keys clash.' },
  smooth: { label: 'Smooth & long', about: 'Long blends (8 bars), soft crossfades, no hard cuts.' },
  club: { label: 'Club cuts', about: 'Short, punchy mixes, loops on builds, hard cuts on clashes.' },
  ambient: { label: 'Ambient washes', about: 'Long smooth crossfades with filters and reverb tails.' },
};

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
  /** Audio features used by the transition rules and the AI pass (0–1, null when unknown). */
  valence: number | null;
  danceability: number | null;
  instrumentalness: number | null;
  acousticness: number | null;
  tags: string[];
  targetEnergy: number;
  locked: boolean;
}

export interface DjTransition {
  /** What to set in Spotify. Starts as the suggestion; the user may edit it. */
  settings: TransitionSettings;
  /** The rule engine's suggestion, kept so an edit can be reset. */
  suggested: TransitionSettings;
  /** Signed tempo change to the next track in percent, after half/double folding. */
  bpmDeltaPct: number;
  keyRelation: KeyRelation;
  /** Energy of next minus energy of this track; null when one is unknown. */
  energyDelta: number | null;
  reason: string;
  /** Spotify will likely show no bar choice (no clear beat grid): skip the bars then. */
  barsMayBeHidden: boolean;
  /** The AI pass's version, if one ran. `settings` equals it until the user edits. */
  ai: { settings: TransitionSettings; reason: string; agent: AgentCli } | null;
  /** The user has set this transition in Spotify (only for created sets). */
  applied: boolean;
}

// ---- AI pass ------------------------------------------------------------------
// The server runs the user's own agent CLI headless (ADR 0004): no API key in
// the app, no tools for the agent, JSON in and out, every value validated.

export type AgentCli = 'claude' | 'codex' | 'gemini';

/** GET /api/dj/ai-pass/agents */
export interface AiPassAgents {
  /** CLIs found on PATH, in preference order. */
  available: AgentCli[];
  /** The one the button will use (AGENT_CLI env wins), or null when none is installed. */
  selected: AgentCli | null;
}

/** POST /api/dj/ai-pass — for a preview send tracks + transitions; for a saved set send setId. */
export interface AiPassRequest {
  setId?: string;
  tracks?: DjSetTrack[];
  transitions?: DjTransition[];
  config?: DjSetConfig;
  /** Optional wish from the user, e.g. "more echo, darker". */
  focus?: string;
}

/** Result of an AI pass job (GET /api/dj/ai-pass/:jobId). */
export interface AiPassResult {
  agent: AgentCli;
  /** One entry per pair the AI changed or confirmed; index = transition index. */
  transitions: { index: number; settings: TransitionSettings; reason: string }[];
  /** Pairs whose AI values failed validation and kept the rule version. */
  rejected: { index: number; problem: string }[];
  /** For a saved set: the updated record (AI values already stored). */
  set: DjSetRecord | null;
  summary: string;
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

/** POST /api/dj/sheet — recompute only the Transition Sheet for these tracks, in this order. */
export interface DjSheetRequest {
  tracks: DjSetTrack[];
  config: DjSetConfig;
}

export interface DjCreateRequest {
  name: string;
  config: DjSetConfig;
  result: DjSetResult;
}

/** draft = saved in the app only; created = also a playlist on Spotify. */
export type DjSetStatus = 'draft' | 'created';

export interface DjSetSummary {
  id: string;
  name: string;
  status: DjSetStatus;
  /** Last change to a draft (name, tracks, sheet); null for sets never edited after saving. */
  updatedAt: string | null;
  createdAt: string;
  tracks: number;
  durationMs: number;
  score: number;
  /** Transitions ticked as applied in Spotify, out of tracks − 1. */
  applied: number;
  spotifyPlaylistId: string | null;
  spotifyUrl: string | null;
}

export interface DjSetRecord extends DjSetSummary {
  config: DjSetConfig;
  result: DjSetResult;
}

/** POST /api/dj/drafts — save a DJ Set in the app without creating it on Spotify. */
export interface DjDraftRequest {
  name: string;
  config: DjSetConfig;
  result: DjSetResult;
}

/** PUT /api/dj/sets/:id — drafts only: rename, or replace the tracks and sheet. */
export interface DjDraftUpdate {
  name?: string;
  config?: DjSetConfig;
  result?: DjSetResult;
}

/** A Set Template the user saved. Without the Pool, applying it keeps the current Pool. */
export interface DjTemplate {
  id: string;
  name: string;
  includePool: boolean;
  config: DjSetConfig;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/dj/templates; PATCH takes any subset. */
export interface DjTemplateInput {
  name: string;
  includePool: boolean;
  config: DjSetConfig;
}

/** PATCH /api/dj/sets/:id/transitions/:index */
export interface DjTransitionPatch {
  settings?: TransitionSettings;
  applied?: boolean;
}

export const DJ_PLAYLIST_DESCRIPTION =
  "DJ Set by Spotify Curator · apply transitions in Spotify › Mix · don't use Smart Reorder";
