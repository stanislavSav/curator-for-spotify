// Owned by the proposals feature. data/proposals.json is written by an Agent
// (`/propose-playlists`, see docs/adr/0001 and 0003) or by the "Generate basic
// proposals" button (Basic Proposals), and reviewed in the web app.
import { z } from 'zod';

export const PROPOSALS_VERSION = 1;

export const PROPOSAL_LIMITS = {
  /** Spotify playlist name limit. */
  name: 100,
  /** Spotify playlist description limit. */
  description: 300,
  minTracks: 15,
  maxTracks: 150,
  minProposals: 6,
  maxProposals: 15,
} as const;

/** Appended to every description when a Proposal is created on Spotify. */
export const CREATED_BY_SUFFIX = ' · by Spotify Curator';

export const PROPOSAL_THEMES = ['genre', 'mood', 'era', 'activity', 'tempo', 'rediscover', 'other'] as const;
export type ProposalTheme = (typeof PROPOSAL_THEMES)[number];

/** Who wrote data/proposals.json. A missing field means an Agent wrote it. */
export const PROPOSAL_GENERATORS = ['agent', 'basic'] as const;
export type ProposalGenerator = (typeof PROPOSAL_GENERATORS)[number];

/** Id prefix of Basic Proposals, so they never collide with Agent-written ids. */
export const BASIC_PROPOSAL_ID_PREFIX = 'basic-';

export const PROPOSAL_STATUSES = ['pending', 'approved', 'dropped', 'created'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

const range = z.tuple([z.number(), z.number()]);

// Shape only. Limits (lengths, track counts, unknown ids) are checked in
// validateProposals so that one bad Proposal does not hide the whole file.
export const ProposalTrackSchema = z.strictObject({
  id: z.string().regex(/^[0-9A-Za-z]{22}$/, 'must be a 22-character Spotify track id'),
  reason: z.string().optional(),
});

export const ProposalRulesSchema = z.strictObject({
  tags: z.array(z.string()).optional(),
  bpm: range.optional(),
  years: range.optional(),
  energy: range.optional(),
  note: z.string().optional(),
});

export const ProposalSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug like "late-night-house"'),
  name: z.string().trim().min(1),
  description: z.string(),
  theme: z.enum(PROPOSAL_THEMES),
  rationale: z.string().trim().min(1),
  rules: ProposalRulesSchema.optional(),
  tracks: z.array(ProposalTrackSchema).min(1),
  confidence: z.number().min(0).max(1),
});

export const ProposalsFileSchema = z.strictObject({
  version: z.literal(PROPOSALS_VERSION),
  generatedAt: z.iso.datetime({ offset: true }),
  snapshotGeneratedAt: z.iso.datetime({ offset: true }),
  /** Optional, so older files stay valid. Treat a missing value as "agent". */
  generator: z.enum(PROPOSAL_GENERATORS).optional(),
  summary: z.string(),
  proposals: z.array(ProposalSchema),
});

export type ProposalTrack = z.infer<typeof ProposalTrackSchema>;
export type ProposalRules = z.infer<typeof ProposalRulesSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type ProposalsFile = z.infer<typeof ProposalsFileSchema>;

// ---- validation ---------------------------------------------------------------

export interface ValidationIssue {
  level: 'error' | 'warning';
  /** Set when the issue belongs to one Proposal. */
  proposalId?: string;
  /** JSON path, e.g. "proposals.2.tracks.4.id". */
  path: string;
  message: string;
}

export interface ValidationContext {
  /** True when the track id exists in the local DB. */
  isKnownTrack: (id: string) => boolean;
  /** generatedAt of the current data/snapshot.json, if any. */
  snapshotGeneratedAt?: string | null;
  /** Owned Playlists with their track ids, to warn about near-duplicates. */
  ownedPlaylists?: { id: string; name: string; trackIds: string[] }[];
}

export interface ValidationResult {
  /** Parsed file; null when the JSON or the schema is broken. */
  file: ProposalsFile | null;
  /** False when the file cannot be used at all (bad JSON, bad shape, duplicate ids). */
  usable: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/** Share of `trackIds` that is also in `other` (0–1). */
export function overlapShare(trackIds: string[], other: Iterable<string>): number {
  if (trackIds.length === 0) return 0;
  const set = other instanceof Set ? (other as Set<string>) : new Set(other);
  return trackIds.filter((id) => set.has(id)).length / trackIds.length;
}

/** Checks one Proposal's content (used for the file and for user edits). */
export function checkProposalContent(
  p: { id: string; name: string; description: string; trackIds: string[] },
  ctx: Pick<ValidationContext, 'isKnownTrack'>,
  basePath = '',
  opts: { minTracks?: number } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (path: string) => (basePath ? `${basePath}.${path}` : path);
  const err = (path: string, message: string) => issues.push({ level: 'error', proposalId: p.id, path: at(path), message });
  const warn = (path: string, message: string) =>
    issues.push({ level: 'warning', proposalId: p.id, path: at(path), message });

  if (p.name.trim().length === 0) err('name', 'Name is empty.');
  if (p.name.length > PROPOSAL_LIMITS.name) err('name', `Name has ${p.name.length} characters; the limit is ${PROPOSAL_LIMITS.name}.`);
  if (p.description.length > PROPOSAL_LIMITS.description)
    err('description', `Description has ${p.description.length} characters; the limit is ${PROPOSAL_LIMITS.description}.`);
  else if (p.description.length > PROPOSAL_LIMITS.description - CREATED_BY_SUFFIX.length)
    warn('description', `Description will be shortened to fit "${CREATED_BY_SUFFIX.trim()}".`);

  const n = p.trackIds.length;
  const minTracks = opts.minTracks ?? PROPOSAL_LIMITS.minTracks;
  if (n < minTracks) err('tracks', `Has ${n} tracks; use at least ${minTracks}.`);
  if (n > PROPOSAL_LIMITS.maxTracks) err('tracks', `Has ${n} tracks; use at most ${PROPOSAL_LIMITS.maxTracks}.`);

  const seen = new Map<string, number>();
  p.trackIds.forEach((id, i) => {
    const first = seen.get(id);
    if (first !== undefined) err(`tracks.${i}.id`, `Track ${id} is listed twice (also at position ${first + 1}).`);
    else seen.set(id, i);
    if (!ctx.isKnownTrack(id)) err(`tracks.${i}.id`, `Track ${id} is not in the local Library.`);
  });
  return issues;
}

/** Validates the raw content of data/proposals.json. Pure: the caller supplies the DB lookups. */
export function validateProposals(raw: unknown, ctx: ValidationContext): ValidationResult {
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (e) {
      const message = `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`;
      return { file: null, usable: false, errors: [{ level: 'error', path: '', message }], warnings: [] };
    }
  }

  const parsed = ProposalsFileSchema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.map<ValidationIssue>((i) => ({
      level: 'error',
      path: i.path.join('.'),
      message: i.message,
    }));
    return { file: null, usable: false, errors, warnings: [] };
  }

  const file = parsed.data;
  const issues: ValidationIssue[] = [];
  const ids = new Map<string, number>();
  let usable = true;

  file.proposals.forEach((p, i) => {
    const first = ids.get(p.id);
    if (first !== undefined) {
      usable = false;
      issues.push({ level: 'error', path: `proposals.${i}.id`, message: `Id "${p.id}" is used twice (also proposals.${first}).` });
    } else ids.set(p.id, i);
    issues.push(
      ...checkProposalContent(
        { id: p.id, name: p.name, description: p.description, trackIds: p.tracks.map((t) => t.id) },
        ctx,
        `proposals.${i}`,
      ),
    );
  });

  const count = file.proposals.length;
  if (count === 0) issues.push({ level: 'error', path: 'proposals', message: 'The file has no proposals.' });
  else if (count < PROPOSAL_LIMITS.minProposals || count > PROPOSAL_LIMITS.maxProposals)
    issues.push({
      level: 'warning',
      path: 'proposals',
      message: `Has ${count} proposals; aim for ${PROPOSAL_LIMITS.minProposals}–${PROPOSAL_LIMITS.maxProposals}.`,
    });

  if (ctx.snapshotGeneratedAt && ctx.snapshotGeneratedAt !== file.snapshotGeneratedAt)
    issues.push({
      level: 'warning',
      path: 'snapshotGeneratedAt',
      message: `Written from a Snapshot of ${file.snapshotGeneratedAt}, but the current Snapshot is from ${ctx.snapshotGeneratedAt}.`,
    });

  // Near-duplicates: of each other and of existing Owned Playlists.
  const trackSets = file.proposals.map((p) => new Set(p.tracks.map((t) => t.id)));
  file.proposals.forEach((p, i) => {
    const ids = p.tracks.map((t) => t.id);
    // Reported on the later Proposal, relative to its own size.
    file.proposals.forEach((q, j) => {
      if (j >= i) return;
      const share = overlapShare(ids, trackSets[j]!);
      if (share >= 0.5)
        issues.push({
          level: 'warning',
          proposalId: p.id,
          path: `proposals.${i}.tracks`,
          message: `${Math.round(share * 100)}% of its tracks are also in "${q.name}".`,
        });
    });
    for (const pl of ctx.ownedPlaylists ?? []) {
      const share = overlapShare(ids, pl.trackIds);
      if (share >= 0.7)
        issues.push({
          level: 'warning',
          proposalId: p.id,
          path: `proposals.${i}.tracks`,
          message: `${Math.round(share * 100)}% of its tracks are already in the Owned Playlist "${pl.name}".`,
        });
    }
  });

  return {
    file,
    usable,
    errors: issues.filter((i) => i.level === 'error'),
    warnings: issues.filter((i) => i.level === 'warning'),
  };
}

// ---- API (features/proposals/routes.ts) ---------------------------------------------

/** User changes stored in proposal_state.edited_json. Missing keys = use the file's value. */
export interface ProposalEdits {
  name?: string;
  description?: string;
  trackIds?: string[];
  /** Fingerprint of the file's track list when trackIds was edited. */
  baseTracksKey?: string;
}

export interface ProposalTrackView {
  id: string;
  /** False when the id is not in the local DB; such tracks are skipped on create. */
  known: boolean;
  name: string;
  artists: string[];
  durationMs: number;
  year: number | null;
  bpm: number | null;
  camelot: string | null;
  energy: number | null;
  tags: string[];
  reason: string | null;
}

export interface ProposalOverlap {
  playlistId: string;
  name: string;
  shared: number;
  /** Share of the Proposal's tracks that are already in the playlist (0–1). */
  share: number;
}

export interface ProposalView {
  id: string;
  theme: ProposalTheme;
  rationale: string;
  rules: ProposalRules | null;
  confidence: number;
  status: ProposalStatus;
  /** Effective values (edits applied). */
  name: string;
  description: string;
  tracks: ProposalTrackView[];
  /** The values from data/proposals.json. */
  original: { name: string; description: string; trackIds: string[] };
  edited: { name: boolean; description: boolean; tracks: boolean };
  /** The proposals file changed the track list after the user edited it. */
  editsOutdated: boolean;
  spotifyPlaylistId: string | null;
  spotifyUrl: string | null;
  stats: {
    count: number;
    unknown: number;
    durationMs: number;
    bpmMin: number | null;
    bpmMax: number | null;
    topTags: string[];
  };
  /** Owned Playlists that share at least a third of the tracks, biggest first. */
  overlaps: ProposalOverlap[];
  issues: ValidationIssue[];
}

export type ProposalsFileStatus = 'missing' | 'invalid' | 'ok';

export interface ProposalsResponse {
  file: {
    status: ProposalsFileStatus;
    path: string;
    generatedAt: string | null;
    snapshotGeneratedAt: string | null;
    /** Who wrote the file; null when there is no usable file. */
    generator: ProposalGenerator | null;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
  };
  /** generatedAt of the current data/snapshot.json, or null if there is none. */
  currentSnapshotAt: string | null;
  summary: string | null;
  proposals: ProposalView[];
  counts: Record<ProposalStatus, number>;
}

export const ProposalPatchSchema = z.strictObject({
  status: z.enum(['pending', 'approved', 'dropped']).optional(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  trackIds: z.array(z.string()).nullable().optional(),
  /** Clears all edits and sets the status back to pending. */
  reset: z.boolean().optional(),
});
/** PATCH /api/proposals/:id. A null field clears that edit. */
export type ProposalPatch = z.infer<typeof ProposalPatchSchema>;

export const BasicProposalsRequestSchema = z.strictObject({ replace: z.boolean().optional() });
/** POST /api/proposals/basic. Without replace, an existing file is a 409. */
export type BasicProposalsRequest = z.infer<typeof BasicProposalsRequestSchema>;
export interface BasicProposalsResponse {
  count: number;
  replaced: boolean;
}
/** Error code of the 409 when data/proposals.json already exists. */
export const PROPOSALS_FILE_EXISTS = 'proposals-file-exists';

export const ApplyProposalsSchema = z.strictObject({ ids: z.array(z.string()).min(1) });
export type ApplyProposalsRequest = z.infer<typeof ApplyProposalsSchema>;

export const spotifyPlaylistUrl = (id: string) => `https://open.spotify.com/playlist/${id}`;

/** Description sent to Spotify: shortened if needed so the suffix fits in 300 characters. */
export function descriptionForSpotify(description: string): string {
  const room = PROPOSAL_LIMITS.description - CREATED_BY_SUFFIX.length;
  const text = description.trim();
  const body = text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text;
  return body ? `${body}${CREATED_BY_SUFFIX}` : CREATED_BY_SUFFIX.replace(/^ · /, '');
}
