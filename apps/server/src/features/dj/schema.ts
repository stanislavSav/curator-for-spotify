import { z } from 'zod';
import {
  EFFECTS_OPTIONS,
  EQ_OPTIONS,
  FILTER_OPTIONS,
  LOOPING_OPTIONS,
  MIX_PRESETS,
  SHEET_STYLES,
  TRANSITION_COLOURS,
  VOLUME_OPTIONS,
  toBars,
  normaliseDjConfig,
  type DjCreateRequest,
  type DjDraftRequest,
  type DjDraftUpdate,
  type DjPreviewRequest,
  type DjTemplateInput,
  type DjSheetRequest,
  type DjSetConfig,
  type DjSetResult,
  type DjTransitionPatch,
  type AgentCli,
  type AiPassRequest,
  type SheetStyle,
  type TransitionColour,
  type TransitionSettings,
} from '@curator/shared';

/** Agent CLIs in preference order (ADR 0004). */
export const AGENT_CLIS = ['claude', 'codex', 'gemini'] as const satisfies readonly AgentCli[];

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
    colour: z.enum(Object.keys(TRANSITION_COLOURS) as [TransitionColour, ...TransitionColour[]]),
    // Older configs allowed 16; incomingConfig normalises that to 8 first.
    defaultBars: z.union([z.literal(4), z.literal(8)]),
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

export const djSetTrackSchema = z.object({
  id,
  uri: z.string().regex(/^spotify:track:[A-Za-z0-9]+$/, 'track uri must look like spotify:track:…'),
  name: z.string(),
  artists: z.array(z.string()),
  durationMs: z.number().min(0),
  bpm: z.number(),
  camelot: z.string().nullable(),
  energy: z.number().nullable(),
  // Added in task 007; older stored sets and clients do not send them.
  valence: z.number().nullable().default(null),
  danceability: z.number().nullable().default(null),
  instrumentalness: z.number().nullable().default(null),
  acousticness: z.number().nullable().default(null),
  tags: z.array(z.string().max(100)).max(20).default([]),
  targetEnergy: z.number(),
  locked: z.boolean(),
});

/** Spotify offers 2, 4 or 8 bars. Older sets stored 16, which reads as 8. */
const bars = z.preprocess((v) => (v === 16 ? toBars(v) : v), z.union([z.literal(2), z.literal(4), z.literal(8)]));

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

export const djTransitionSchema = z.object({
  settings: transitionSettingsSchema,
  suggested: transitionSettingsSchema,
  bpmDeltaPct: z.number(),
  keyRelation: z.enum(['same', 'adjacent', 'relative', 'energy-boost', 'clash', 'unknown']),
  energyDelta: z.number().nullable(),
  reason: z.string(),
  barsMayBeHidden: z.boolean().default(false),
  ai: z
    .object({ settings: transitionSettingsSchema, reason: z.string().max(500), agent: z.enum(AGENT_CLIS) })
    .nullable()
    .default(null),
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

export const djSheetSchema = z.object({
  tracks: z.array(djSetTrackSchema).min(2, 'A sheet needs at least two tracks'),
  config: incomingConfig,
}) satisfies z.ZodType<DjSheetRequest>;

const setName = z.string().trim().min(1, 'Give the set a name').max(100);

export const djCreateSchema = z.object({
  name: setName,
  config: incomingConfig,
  result: djSetResultSchema,
}) satisfies z.ZodType<DjCreateRequest>;

/** POST /api/dj/drafts: the same body as a create. */
export const djDraftSchema = djCreateSchema satisfies z.ZodType<DjDraftRequest>;

/** PUT /api/dj/sets/:id: rename a draft, or replace its tracks and sheet. */
export const djDraftUpdateSchema = z
  .object({ name: setName.optional(), config: incomingConfig.optional(), result: djSetResultSchema.optional() })
  .refine((u) => u.name !== undefined || u.config !== undefined || u.result !== undefined, 'Send name, config, result or a mix') satisfies z.ZodType<DjDraftUpdate>;

const templateFields = {
  name: z.string().trim().min(1, 'Give the template a name').max(60),
  includePool: z.boolean(),
  config: incomingConfig,
};

export const djTemplateInputSchema = z.object(templateFields) satisfies z.ZodType<DjTemplateInput>;

/** PATCH /api/dj/templates/:id: any subset of the input. */
export const djTemplatePatchSchema = z
  .object(templateFields)
  .partial()
  .refine((p) => Object.values(p).some((v) => v !== undefined), 'Send name, includePool, config or a mix') satisfies z.ZodType<Partial<DjTemplateInput>>;

export const djTransitionPatchSchema = z
  .object({ settings: transitionSettingsSchema.optional(), applied: z.boolean().optional() })
  .refine((p) => p.settings !== undefined || p.applied !== undefined, 'Send settings, applied or both') satisfies z.ZodType<DjTransitionPatch>;

/** POST /api/dj/ai-pass: a saved set by id, or a preview's tracks and transitions. */
export const aiPassRequestSchema = z
  .object({
    setId: id.optional(),
    tracks: z.array(djSetTrackSchema).min(2).max(300).optional(),
    transitions: z.array(djTransitionSchema).optional(),
    config: incomingConfig.optional(),
    focus: z.string().max(300).optional(),
  })
  .refine(
    (r) => r.setId != null || (r.tracks != null && r.transitions != null && r.transitions.length === r.tracks.length - 1),
    'Send setId, or tracks with one transition per track pair',
  ) satisfies z.ZodType<AiPassRequest>;
