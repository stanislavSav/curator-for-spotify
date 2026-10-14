import { z } from 'zod';
import type { DjCreateRequest, DjPreviewRequest, DjSetConfig, DjSetResult } from '@curator/shared';

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
    defaultBars: z.union([z.literal(4), z.literal(8), z.literal(16)]),
    styles: z.object({ Fade: z.boolean(), Rise: z.boolean(), Blend: z.boolean() }),
    rules: z.object({
      longBlendWhenCompatible: z.boolean(),
      riseOnEnergyJump: z.boolean(),
      shortFadeOnClash: z.boolean(),
      autoWhenUnknown: z.boolean(),
    }),
  }),
}) satisfies z.ZodType<DjSetConfig>;

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

const djTransitionSchema = z.object({
  style: z.enum(['Auto', 'Fade', 'Rise', 'Blend']),
  bars: z.union([z.literal(2), z.literal(4), z.literal(8), z.literal(16)]).nullable(),
  bpmDeltaPct: z.number(),
  keyRelation: z.enum(['same', 'adjacent', 'relative', 'energy-boost', 'clash', 'unknown']),
  energyDelta: z.number().nullable(),
  eqHint: z.string().nullable(),
  cutHint: z.boolean(),
  reason: z.string(),
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
  config: djSetConfigSchema,
  seed: z.number().int().min(0).max(2 ** 32 - 1),
}) satisfies z.ZodType<DjPreviewRequest>;

export const djCreateSchema = z.object({
  name: z.string().trim().min(1, 'Give the set a name').max(100),
  config: djSetConfigSchema,
  result: djSetResultSchema,
}) satisfies z.ZodType<DjCreateRequest>;
