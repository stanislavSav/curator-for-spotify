import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PROPOSAL_LIMITS,
  PROPOSAL_STATUSES,
  camelotLabel,
  checkProposalContent,
  descriptionForSpotify,
  overlapShare,
  spotifyPlaylistUrl,
  toCamelot,
  validateProposals,
  type LibraryTrack,
  type Proposal,
  type ProposalEdits,
  type ProposalOverlap,
  type ProposalPatch,
  type ProposalStatus,
  type ProposalTrackView,
  type ProposalView,
  type ProposalsResponse,
  type ValidationResult,
} from '@curator/shared';
import { DATA_DIR, nowIso, type DB } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import type { SpotifyClient } from '../../spotify/client.ts';

export interface ProposalPaths {
  proposals: string;
  snapshot: string;
}

export const defaultPaths = (): ProposalPaths => ({
  proposals: resolve(DATA_DIR, 'proposals.json'),
  snapshot: resolve(DATA_DIR, 'snapshot.json'),
});

export class ProposalError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
    /** Machine-readable reason, sent to the UI as `code`. */
    readonly code?: string,
  ) {
    super(message);
  }
}

// ---- files ------------------------------------------------------------------------

/** Raw text of a file, or null when it does not exist. */
function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

// The Snapshot can be several MB; only re-parse it when it changes.
let snapshotCache: { path: string; mtimeMs: number; generatedAt: string | null } | null = null;

export function snapshotGeneratedAt(path: string): string | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    return null;
  }
  if (snapshotCache?.path === path && snapshotCache.mtimeMs === mtimeMs) return snapshotCache.generatedAt;
  let generatedAt: string | null = null;
  try {
    const value = (JSON.parse(readFileSync(path, 'utf8')) as { generatedAt?: unknown }).generatedAt;
    generatedAt = typeof value === 'string' ? value : null;
  } catch {
    generatedAt = null;
  }
  snapshotCache = { path, mtimeMs, generatedAt };
  return generatedAt;
}

// ---- DB lookups --------------------------------------------------------------------

export function knownTrackIds(db: DB): Set<string> {
  return new Set((db.prepare('SELECT id FROM tracks').all() as { id: string }[]).map((r) => r.id));
}

/** Owned Playlists still in the Library, minus the ones this feature created. */
export function ownedPlaylistTracks(db: DB): { id: string; name: string; trackIds: string[] }[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.name, pi.track_id FROM playlists p
       JOIN playlist_items pi ON pi.playlist_id = p.id
       WHERE p.kind = 'owned' AND p.removed_at IS NULL
         AND p.id NOT IN (SELECT spotify_playlist_id FROM proposal_state WHERE spotify_playlist_id IS NOT NULL)
       ORDER BY p.id, pi.position`,
    )
    .all() as { id: string; name: string; track_id: string }[];
  const byId = new Map<string, { id: string; name: string; trackIds: string[] }>();
  for (const r of rows) {
    const pl = byId.get(r.id) ?? { id: r.id, name: r.name, trackIds: [] };
    pl.trackIds.push(r.track_id);
    byId.set(r.id, pl);
  }
  return [...byId.values()];
}

// ---- state ----------------------------------------------------------------------------

interface StateRow {
  proposal_id: string;
  status: ProposalStatus;
  edited_json: string | null;
  spotify_playlist_id: string | null;
  updated_at: string;
}

export interface ProposalState {
  status: ProposalStatus;
  edits: ProposalEdits;
  spotifyPlaylistId: string | null;
}

const EMPTY_STATE: ProposalState = { status: 'pending', edits: {}, spotifyPlaylistId: null };

export function readState(db: DB, id: string): ProposalState {
  const row = db.prepare('SELECT * FROM proposal_state WHERE proposal_id = ?').get(id) as StateRow | undefined;
  if (!row) return { ...EMPTY_STATE, edits: {} };
  return {
    status: row.status,
    edits: row.edited_json ? (JSON.parse(row.edited_json) as ProposalEdits) : {},
    spotifyPlaylistId: row.spotify_playlist_id,
  };
}

function writeState(db: DB, id: string, s: ProposalState) {
  const edits = Object.keys(s.edits).length > 0 ? JSON.stringify(s.edits) : null;
  db.prepare(
    `INSERT INTO proposal_state (proposal_id, status, edited_json, spotify_playlist_id, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(proposal_id) DO UPDATE SET status = excluded.status, edited_json = excluded.edited_json,
       spotify_playlist_id = excluded.spotify_playlist_id, updated_at = excluded.updated_at`,
  ).run(id, s.status, edits, s.spotifyPlaylistId, nowIso());
}

/** All saved states, including ids that are no longer in the file (kept on purpose). */
export function allStates(db: DB): Map<string, ProposalState> {
  const rows = db.prepare('SELECT proposal_id FROM proposal_state').all() as { proposal_id: string }[];
  return new Map(rows.map((r) => [r.proposal_id, readState(db, r.proposal_id)]));
}

export const tracksKey = (ids: string[]) => createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16);

/** The Proposal with the user's edits applied. */
export function effective(p: Proposal, edits: ProposalEdits) {
  const reasons = new Map(p.tracks.map((t) => [t.id, t.reason ?? null]));
  const trackIds = edits.trackIds ?? p.tracks.map((t) => t.id);
  return {
    name: edits.name ?? p.name,
    description: edits.description ?? p.description,
    trackIds,
    reasons,
  };
}

// ---- load + validate -----------------------------------------------------------------

export interface LoadedProposals {
  status: 'missing' | 'invalid' | 'ok';
  validation: ValidationResult | null;
  currentSnapshotAt: string | null;
}

export function loadProposals(db: DB, paths: ProposalPaths = defaultPaths()): LoadedProposals {
  const currentSnapshotAt = snapshotGeneratedAt(paths.snapshot);
  const text = readText(paths.proposals);
  if (text === null) return { status: 'missing', validation: null, currentSnapshotAt };
  const known = knownTrackIds(db);
  const validation = validateProposals(text, {
    isKnownTrack: (id) => known.has(id),
    snapshotGeneratedAt: currentSnapshotAt,
    ownedPlaylists: ownedPlaylistTracks(db),
  });
  return { status: validation.usable ? 'ok' : 'invalid', validation, currentSnapshotAt };
}

function usableFile(db: DB, paths: ProposalPaths) {
  const loaded = loadProposals(db, paths);
  if (loaded.status !== 'ok' || !loaded.validation?.file)
    throw new ProposalError(409, loaded.status === 'missing' ? 'There is no proposals file.' : 'The proposals file is invalid.');
  return loaded.validation.file;
}

function findProposal(db: DB, id: string, paths: ProposalPaths): Proposal {
  const p = usableFile(db, paths).proposals.find((x) => x.id === id);
  if (!p) throw new ProposalError(404, `No proposal with id "${id}" in the current file.`);
  return p;
}

// ---- GET ----------------------------------------------------------------------------------

function trackView(id: string, t: LibraryTrack | undefined, reason: string | null): ProposalTrackView {
  if (!t)
    return { id, known: false, name: 'Unknown track', artists: [], durationMs: 0, year: null, bpm: null, camelot: null, energy: null, tags: [], reason };
  const f = t.features;
  const cam = toCamelot(f?.key, f?.mode);
  const year = t.releaseDate ? Number(t.releaseDate.slice(0, 4)) : NaN;
  return {
    id,
    known: true,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    durationMs: t.durationMs,
    year: Number.isFinite(year) ? year : null,
    bpm: f?.tempo != null ? Math.round(f.tempo) : null,
    camelot: cam ? camelotLabel(cam) : null,
    energy: f?.energy ?? null,
    tags: t.tags.slice(0, 4),
    reason,
  };
}

function stats(tracks: ProposalTrackView[]): ProposalView['stats'] {
  const known = tracks.filter((t) => t.known);
  const bpms = known.map((t) => t.bpm).filter((b): b is number => b != null);
  const tagCounts = new Map<string, number>();
  for (const t of known) for (const tag of t.tags) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
  return {
    count: tracks.length,
    unknown: tracks.length - known.length,
    durationMs: known.reduce((s, t) => s + t.durationMs, 0),
    bpmMin: bpms.length ? Math.min(...bpms) : null,
    bpmMax: bpms.length ? Math.max(...bpms) : null,
    topTags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([tag]) => tag),
  };
}

export function getProposals(db: DB, paths: ProposalPaths = defaultPaths()): ProposalsResponse {
  const loaded = loadProposals(db, paths);
  const v = loaded.validation;
  const counts = Object.fromEntries(PROPOSAL_STATUSES.map((s) => [s, 0])) as ProposalsResponse['counts'];
  const base: ProposalsResponse = {
    file: {
      status: loaded.status,
      path: paths.proposals,
      generatedAt: v?.file?.generatedAt ?? null,
      snapshotGeneratedAt: v?.file?.snapshotGeneratedAt ?? null,
      generator: v?.file ? (v.file.generator ?? 'agent') : null,
      errors: v?.errors ?? [],
      warnings: v?.warnings ?? [],
    },
    currentSnapshotAt: loaded.currentSnapshotAt,
    summary: null,
    proposals: [],
    counts,
  };
  if (loaded.status !== 'ok' || !v?.file) return base;

  const file = v.file;
  const states = allStates(db);
  const resolved = file.proposals.map((p) => {
    const state = states.get(p.id) ?? EMPTY_STATE;
    return { p, state, eff: effective(p, state.edits) };
  });
  const allIds = [...new Set(resolved.flatMap((r) => [...r.eff.trackIds, ...r.p.tracks.map((t) => t.id)]))];
  const library = new Map(getLibraryTracks(db, allIds).map((t) => [t.id, t]));
  const known = { isKnownTrack: (id: string) => library.has(id) };
  const owned = ownedPlaylistTracks(db);

  const proposals = resolved.map(({ p, state, eff }): ProposalView => {
    const tracks = eff.trackIds.map((id) => trackView(id, library.get(id), eff.reasons.get(id) ?? null));
    const originalIds = p.tracks.map((t) => t.id);
    const overlaps: ProposalOverlap[] = owned
      .map((pl) => {
        const share = overlapShare(eff.trackIds, pl.trackIds);
        return { playlistId: pl.id, name: pl.name, share, shared: Math.round(share * eff.trackIds.length) };
      })
      .filter((o) => o.share >= 1 / 3)
      .sort((a, b) => b.share - a.share)
      .slice(0, 3);
    const tracksEdited = state.edits.trackIds !== undefined;
    counts[state.status]++;
    return {
      id: p.id,
      theme: p.theme,
      rationale: p.rationale,
      rules: p.rules ?? null,
      confidence: p.confidence,
      status: state.status,
      name: eff.name,
      description: eff.description,
      tracks,
      original: { name: p.name, description: p.description, trackIds: originalIds },
      edited: {
        name: state.edits.name !== undefined,
        description: state.edits.description !== undefined,
        tracks: tracksEdited,
      },
      editsOutdated: tracksEdited && state.edits.baseTracksKey !== tracksKey(originalIds),
      spotifyPlaylistId: state.spotifyPlaylistId,
      spotifyUrl: state.spotifyPlaylistId ? spotifyPlaylistUrl(state.spotifyPlaylistId) : null,
      stats: stats(tracks),
      overlaps,
      // User edits may shorten a Proposal below the file minimum; that is their call.
      issues: checkProposalContent({ id: p.id, ...eff }, known, '', tracksEdited ? { minTracks: 1 } : undefined),
    };
  });

  return { ...base, summary: file.summary, proposals };
}

// ---- PATCH -------------------------------------------------------------------------------

export function patchProposal(db: DB, id: string, patch: ProposalPatch, paths: ProposalPaths = defaultPaths()) {
  const p = findProposal(db, id, paths);
  const state = readState(db, id);
  if (state.status === 'created') throw new ProposalError(409, 'This proposal is already on Spotify.');

  if (patch.reset) {
    writeState(db, id, { status: 'pending', edits: {}, spotifyPlaylistId: null });
    return;
  }

  const edits: ProposalEdits = { ...state.edits };
  if (patch.name !== undefined) {
    const name = patch.name?.trim();
    if (name !== undefined && (name.length === 0 || name.length > PROPOSAL_LIMITS.name))
      throw new ProposalError(400, `The name must have 1–${PROPOSAL_LIMITS.name} characters.`);
    if (name === undefined || name === p.name) delete edits.name;
    else edits.name = name;
  }
  if (patch.description !== undefined) {
    const description = patch.description?.trim();
    if (description !== undefined && description.length > PROPOSAL_LIMITS.description)
      throw new ProposalError(400, `The description must have at most ${PROPOSAL_LIMITS.description} characters.`);
    if (description === undefined || description === p.description) delete edits.description;
    else edits.description = description;
  }
  if (patch.trackIds !== undefined) {
    const ids = patch.trackIds;
    const originalIds = p.tracks.map((t) => t.id);
    if (ids !== null) {
      if (ids.length === 0) throw new ProposalError(400, 'A proposal needs at least one track. Drop it instead.');
      if (ids.length > PROPOSAL_LIMITS.maxTracks)
        throw new ProposalError(400, `A playlist can have at most ${PROPOSAL_LIMITS.maxTracks} tracks here.`);
      if (new Set(ids).size !== ids.length) throw new ProposalError(400, 'The track list has duplicates.');
      const known = knownTrackIds(db);
      const allowed = new Set(originalIds);
      const bad = ids.find((t) => !allowed.has(t) && !known.has(t));
      if (bad) throw new ProposalError(400, `Track ${bad} is not in the local Library.`);
    }
    if (ids === null || ids.join(',') === originalIds.join(',')) {
      delete edits.trackIds;
      delete edits.baseTracksKey;
    } else {
      edits.trackIds = ids;
      edits.baseTracksKey = tracksKey(originalIds);
    }
  }
  writeState(db, id, { ...state, status: patch.status ?? state.status, edits });
}

// ---- apply -------------------------------------------------------------------------------

export interface ApplyResult {
  created: { id: string; name: string; spotifyPlaylistId: string; tracks: number }[];
  skipped: { id: string; reason: string }[];
  failed: { id: string; name: string; error: string }[];
}

/** Ids from the request that can be created now: approved and in the current file. */
export function applicableIds(db: DB, ids: string[], paths: ProposalPaths = defaultPaths()): string[] {
  const file = usableFile(db, paths);
  const inFile = new Set(file.proposals.map((p) => p.id));
  return ids.filter((id) => inFile.has(id) && readState(db, id).status === 'approved');
}

/**
 * Creates each approved Proposal as a private playlist. Already created ones are
 * skipped, so a retry after a failure never makes duplicates.
 */
export async function applyProposals(
  db: DB,
  client: Pick<SpotifyClient, 'createPlaylist'>,
  ids: string[],
  progress: (done: number, total: number, message?: string) => void = () => {},
  paths: ProposalPaths = defaultPaths(),
): Promise<ApplyResult> {
  const file = usableFile(db, paths);
  const byId = new Map(file.proposals.map((p) => [p.id, p]));
  const uris = new Map(
    (db.prepare('SELECT id, uri FROM tracks').all() as { id: string; uri: string }[]).map((r) => [r.id, r.uri]),
  );
  const result: ApplyResult = { created: [], skipped: [], failed: [] };

  for (const [i, id] of ids.entries()) {
    const p = byId.get(id);
    const state = readState(db, id);
    if (!p) {
      result.skipped.push({ id, reason: 'not in the current file' });
      continue;
    }
    if (state.status === 'created') {
      result.skipped.push({ id, reason: 'already created' });
      continue;
    }
    if (state.status !== 'approved') {
      result.skipped.push({ id, reason: `status is ${state.status}` });
      continue;
    }
    const eff = effective(p, state.edits);
    progress(i, ids.length, `Creating "${eff.name}"`);
    const trackUris = eff.trackIds.map((t) => uris.get(t)).filter((u): u is string => Boolean(u));
    if (trackUris.length === 0) {
      result.failed.push({ id, name: eff.name, error: 'none of its tracks are in the local Library' });
      continue;
    }
    try {
      const created = await client.createPlaylist({
        name: eff.name.slice(0, PROPOSAL_LIMITS.name),
        description: descriptionForSpotify(eff.description),
        uris: trackUris,
      });
      writeState(db, id, { ...state, status: 'created', spotifyPlaylistId: created.id });
      result.created.push({ id, name: eff.name, spotifyPlaylistId: created.id, tracks: trackUris.length });
    } catch (e) {
      result.failed.push({ id, name: eff.name, error: e instanceof Error ? e.message : String(e) });
    }
  }
  progress(ids.length, ids.length, 'Done');
  return result;
}

export function applySummary(r: ApplyResult): string {
  const parts = [`Created ${r.created.length} playlist${r.created.length === 1 ? '' : 's'}.`];
  if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}.`);
  if (r.failed.length) parts.push(`Failed: ${r.failed.map((f) => `"${f.name}" (${f.error})`).join('; ')}`);
  return parts.join(' ');
}
