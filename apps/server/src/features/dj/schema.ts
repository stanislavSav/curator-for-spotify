import { z } from 'zod';
import {
  EFFECTS_OPTIONS,
  EQ_OPTIONS,
  FILTER_OPTIONS,
  LOOPING_OPTIONS,
  MIX_PRESETS,
  SHEET_STYLES,
  VOLUME_OPTIONS,
  normaliseDjConfig,
  type DjCreateRequest,
  type DjPreviewRequest,
  type DjSetConfig,
  type DjSetResult,
  type DjTransitionPatch,
  type SheetStyle,
  type TransitionSettings,
} from '@curator/shared';

const energy = z.number().min(0).max(1);
const bpm = z.number().min(30).max(300);
const id = z.string().min(1).max(64);

const curve = z.union([
  z.object({ preset: z.enum(['warmup-peak-cooldown', 'steady', 'build', 'wave', 'cooldown']) }),
  z.object({ preset: z.literal('custom'), points: z.array(energy).min(2).max(24) }),
]);

export const djSetConfigSchema = z.object({
  pool: z.object({
    playlistIds: z.array(id).max(500),
    library: z
      .object({
        tags: z.array(z.string().max(100)).max(50),
        decades: z.array(z.number().int().min(1900).max(2100)).max(20),
        bpmMin: bpm.nullable(),
        bpmMax: bpm.nullable(),
        energyMin: energy.nullable(),
        energyMax: energy.nullable(),
        likedOnly: z.boolean(),
      })
      .nullable(),
    recent: z.object({ short_term: z.boolean(), medium_term: z.boolean(), long_term: z.boolean() }),
  }),
  length: z.union([
    z.object({ mode: z.literal('minutes'), minutes: z.number().min(5).max(600) }),
    z.object({ mode: z.literal('tracks'), count: z.number().int().min(2).max(300) }),
  ]),
  curve,
  bpmRange: z
    .object({ min: bpm, max: bpm })
    .refine((r) => r.min <= r.max, 'BPM range: min must not be above max')
    .nullable(),
  maxBpmStepPct: z.number().min(0.5).max(30),
  allowHalfDouble: z.boolean(),
  keyStrictness: z.enum(['strict', 'relaxed', 'off']),
  artistSpacing: z.number().int().min(0).max(20),
  startTrackId: id.nullable(),
  lockedTrackIds: z.array(id).max(100),
  excludedTrackIds: z.array(id).max(2000),
  transitions: z.object({
    sheetStyle: z.enum(Object.keys(SHEET_STYLES) as [SheetStyle, ...SheetStyle[]]),
    defaultBars: z.union([z.literal(4), z.literal(8), z.literal(16)]),
    rules: z.object({
      longBlendWhenCompatible: z.boolean(),
      riseOnEnergyJump: z.boolean(),
      shortFadeOnClash: z.boolean(),
      autoWhenUnknown: z.boolean(),
    }),
  }),
}) satisfies z.ZodType<DjSetConfig>;

/** Older or partial configs (stored sets, localStorage) are filled up to the current shape first. */
const incomingConfig = z.preprocess((v) => (v && typeof v === 'object' ? normaliseDjConfig(v) : v), djSetConfigSchema);

const djSetTrackSchema = z.object({
  id,
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/, 'track uri must look like spotify:track:…'),
  name: z.string(),
  artists: z.array(z.string()),
  durationMs: z.number().min(0),
  bpm: z.number(),
  camelot: z.string().nullable(),
  energy: z.number().nullable(),
  targetEnergy: z.number(),
  locked: z.boolean(),
});

const bars = z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]);

/** Every value must be one of Spotify's exact option names (shared lists). */
export const transitionSettingsSchema = z.object({
  preset: z.enum(MIX_PRESETS),
  bars: bars.nullable(),
  volume: z.enum(VOLUME_OPTIONS).nullable(),
  eq: z.enum(EQ_OPTIONS).nullable(),
  filter: z.enum(FILTER_OPTIONS).nullable(),
  effects: z.enum(EFFECTS_OPTIONS).nullable(),
  looping: z.enum(LOOPING_OPTIONS).nullable(),
}) satisfies z.ZodType<TransitionSettings>;

const djTransitionSchema = z.object({
  settings: transitionSettingsSchema,
  suggested: transitionSettingsSchema,
  bpmDeltaPct: z.number(),
  keyRelation: z.enum(['same', 'adjacent', 'relative', 'energy-boost', 'clash', 'unknown']),
  energyDelta: z.number().nullable(),
  reason: z.string(),
  applied: z.boolean().default(false),
});

export const djSetResultSchema = z
  .object({
    seed: z.number(),
    tracks: z.array(djSetTrackSchema).min(1).max(300),
    transitions: z.array(djTransitionSchema),
    score: z.object({
      total: z.number(),
      bpmSmooth: z.number(),
      keyCompatible: z.number(),
      energyFit: z.number(),
      artistRepeats: z.number(),
      cost: z.number(),
    }),
    warnings: z.array(z.string()),
    pool: z.object({
      total: z.number(),
      usable: z.number(),
      noTempo: z.number(),
      outOfBpmRange: z.number(),
      noKey: z.number(),
      noEnergy: z.number(),
    }),
    durationMs: z.number(),
  })
  .refine((r) => r.transitions.length === r.tracks.length - 1, 'transitions must have one entry per track pair') satisfies z.ZodType<DjSetResult>;

export const djPreviewSchema = z.object({
  config: incomingConfig,
  seed: z.number().int().min(0).max(2 ** 32 - 1),
}) satisfies z.ZodType<DjPreviewRequest>;

export const djCreateSchema = z.object({
  name: z.string().trim().min(1, 'Give the set a name').max(100),
  config: incomingConfig,
  result: djSetResultSchema,
}) satisfies z.ZodType<DjCreateRequest>;

export const djTransitionPatchSchema = z
  .object({ settings: transitionSettingsSchema.optional(), applied: z.boolean().optional() })
  .refine((p) => p.settings !== undefined || p.applied !== undefined, 'Send settings, applied or both') satisfies z.ZodType<DjTransitionPatch>;
