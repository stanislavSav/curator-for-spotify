import {
  DJ_PLAYLIST_DESCRIPTION,
  normaliseDjConfig,
  type DjCreateRequest,
  type DjDraftUpdate,
  type DjSetConfig,
  type DjSetRecord,
  type DjSetResult,
  type DjSetStatus,
  type DjSetSummary,
  type DjSetTrack,
  type DjSpotifyUpdateRequest,
  type DjTransition,
  type DjTransitionPatch,
  type TransitionSettings,
  toBars,
} from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';
import { SpotifyApiError, type SpotifyClient } from '../../spotify/client.ts';
import { parseCamelot } from './harmony.ts';
import { AUTO, likelyNoBeatGrid, setPositions, suggestTransition, type SetPosition, type TransitionEnd } from './transitions.ts';

interface Row {
  id: string;
  name: string;
  config_json: string;
  result_json: string;
  spotify_playlist_id: string | null;
  created_at: string;
  status: DjSetStatus;
  updated_at: string | null;
}

const playlistUrl = (id: string | null) => (id ? `https://open.spotify.com/playlist/${id}` : null);

const end = (t: DjSetTrack): TransitionEnd => ({ ...t, camelot: parseCamelot(t.camelot) });

/**
 * The Transition Sheet for tracks in a fixed order: used when only the sheet
 * settings change (Sheet Style, Colour, bars, rules), so the set itself stays.
 */
export function sheetFor(tracks: DjSetTrack[], cfg: DjSetConfig): DjTransition[] {
  const positions = setPositions(tracks.map((t) => t.targetEnergy));
  return tracks.slice(1).map((b, i) => suggestTransition(end(tracks[i]!), end(b), cfg, positions[i]));
}

/** Tracks saved before task 007 have no audio features or tags. */
function normaliseTrack(t: DjSetTrack): DjSetTrack {
  return {
    ...t,
    valence: t.valence ?? null,
    danceability: t.danceability ?? null,
    instrumentalness: t.instrumentalness ?? null,
    acousticness: t.acousticness ?? null,
    tags: t.tags ?? [],
  };
}

/** Spotify offers at most 8 bars; sets saved before task 007 may hold 16. */
const clampSettings = (s: TransitionSettings): TransitionSettings => ({ ...s, bars: toBars(s.bars) });

/**
 * Sets saved before task 006 have transitions without settings (style, bars,
 * eqHint, cutHint). They get fresh suggestions from the stored tracks; when the
 * tracks are missing, Auto. Sets saved before task 007 get bars clamped to 8,
 * barsMayBeHidden and an empty AI pass.
 */
function normaliseTransition(raw: unknown, i: number, tracks: DjSetTrack[], cfg: DjSetConfig, pos: SetPosition | undefined): DjTransition {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Partial<DjTransition>;
  const a = tracks[i];
  const b = tracks[i + 1];
  if (t.settings && typeof t.settings === 'object') {
    return {
      ...t,
      settings: clampSettings(t.settings),
      suggested: clampSettings(t.suggested ?? t.settings),
      barsMayBeHidden: t.barsMayBeHidden ?? (a && b ? likelyNoBeatGrid(end(a)) || likelyNoBeatGrid(end(b)) : false),
      ai: t.ai ? { ...t.ai, settings: clampSettings(t.ai.settings) } : null,
      applied: t.applied === true,
    } as DjTransition;
  }
  if (a && b && a.bpm > 0 && b.bpm > 0) return suggestTransition(end(a), end(b), cfg, pos);
  return {
    settings: { ...AUTO },
    suggested: { ...AUTO },
    bpmDeltaPct: t.bpmDeltaPct ?? 0,
    keyRelation: t.keyRelation ?? 'unknown',
    energyDelta: t.energyDelta ?? null,
    reason: t.reason ?? '',
    barsMayBeHidden: false,
    ai: null,
    applied: false,
  };
}

function toRecord(r: Row): DjSetRecord {
  const config = normaliseDjConfig(JSON.parse(r.config_json));
  const stored = JSON.parse(r.result_json) as DjSetResult;
  const tracks = (stored.tracks ?? []).map(normaliseTrack);
  const positions = setPositions(tracks.map((t) => t.targetEnergy));
  const result: DjSetResult = {
    ...stored,
    tracks,
    transitions: (stored.transitions ?? []).map((t, i) => normaliseTransition(t, i, tracks, config, positions[i])),
  };
  return {
    id: r.id,
    name: r.name,
    // A row without a playlist id that says 'created' stays as it is (an old failed create).
    status: r.status === 'draft' ? 'draft' : 'created',
    updatedAt: r.updated_at,
    createdAt: r.created_at,
    tracks: tracks.length,
    durationMs: result.durationMs,
    score: result.score.total,
    applied: result.transitions.filter((t) => t.applied).length,
    spotifyPlaylistId: r.spotify_playlist_id,
    spotifyUrl: playlistUrl(r.spotify_playlist_id),
    config,
    result,
  };
}

export function saveDjSet(db: DB, id: string, req: DjCreateRequest, spotifyPlaylistId: string | null, status: DjSetStatus = 'created') {
  db.prepare(
    `INSERT INTO dj_sets (id, name, config_json, result_json, spotify_playlist_id, created_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, req.name, JSON.stringify(req.config), JSON.stringify(req.result), spotifyPlaylistId, nowIso(), status);
}

/** Saves a Draft: the set lives in the app only, nothing goes to Spotify. */
export function saveDjDraft(db: DB, id: string, req: DjCreateRequest): DjSetRecord {
  saveDjSet(db, id, req, null, 'draft');
  return getDjSet(db, id)!;
}

/** Renames a draft or replaces its config, tracks and sheet. The caller checks that it is a draft. */
export function updateDjDraft(db: DB, id: string, update: DjDraftUpdate): DjSetRecord | null {
  const set = getDjSet(db, id);
  if (!set) return null;
  db.prepare('UPDATE dj_sets SET name = ?, config_json = ?, result_json = ?, updated_at = ? WHERE id = ?').run(
    update.name ?? set.name,
    JSON.stringify(update.config ?? set.config),
    JSON.stringify(update.result ?? set.result),
    nowIso(),
    id,
  );
  return getDjSet(db, id);
}

/** Removes only the local record; a playlist already on Spotify stays there. */
export function deleteDjSet(db: DB, id: string): boolean {
  return db.prepare('DELETE FROM dj_sets WHERE id = ?').run(id).changes > 0;
}

export function getDjSet(db: DB, id: string): DjSetRecord | null {
  const row = db.prepare('SELECT * FROM dj_sets WHERE id = ?').get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listDjSets(db: DB): DjSetSummary[] {
  const rows = db.prepare('SELECT * FROM dj_sets ORDER BY created_at DESC, rowid DESC').all() as Row[];
  return rows.map((r) => {
    const { config: _c, result: _r, ...summary } = toRecord(r);
    return summary;
  });
}

/**
 * Edits one transition of a created set (settings and/or the Applied tick).
 * Returns null when the set or the index does not exist. Also stores the
 * normalised result, so an old-shape set is migrated on its first edit.
 */
export function patchDjTransition(db: DB, id: string, index: number, patch: DjTransitionPatch): DjSetRecord | null {
  const set = getDjSet(db, id);
  const current = set?.result.transitions[index];
  if (!set || !current) return null;
  set.result.transitions[index] = {
    ...current,
    ...(patch.settings ? { settings: patch.settings } : {}),
    ...(patch.applied !== undefined ? { applied: patch.applied } : {}),
  };
  return saveDjSetResult(db, id, set.result);
}

/** Stores a new result (sheet edits, AI pass). Every change to a draft moves its updated_at. */
export function saveDjSetResult(db: DB, id: string, result: DjSetResult): DjSetRecord | null {
  db.prepare(
    `UPDATE dj_sets SET result_json = ?, updated_at = CASE WHEN status = 'draft' THEN ? ELSE updated_at END WHERE id = ?`,
  ).run(JSON.stringify(result), nowIso(), id);
  return getDjSet(db, id);
}

/**
 * Creates the DJ Set as a new private playlist and records it. A rebuild always
 * makes a new playlist: reordering one the user already mixed can reset its
 * Transitions (ADR 0002).
 */
export async function createDjSet(
  db: DB,
  client: SpotifyClient,
  id: string,
  req: DjCreateRequest,
  progress: (done: number, total: number, message?: string) => void = () => {},
) {
  const uris = req.result.tracks.map((t) => t.uri);
  progress(0, uris.length, 'Creating the playlist on Spotify…');
  const playlist = await client.createPlaylist({ name: req.name, description: DJ_PLAYLIST_DESCRIPTION, uris });
  progress(uris.length, uris.length, 'Saving the set…');
  saveDjSet(db, id, req, playlist.id);
  return playlist;
}

/**
 * Creates a saved draft as a new private playlist, then marks the set created.
 * Uses the draft as it was when the job started.
 */
export async function createDjDraftOnSpotify(
  db: DB,
  client: SpotifyClient,
  draft: DjSetRecord,
  progress: (done: number, total: number, message?: string) => void = () => {},
) {
  const uris = draft.result.tracks.map((t) => t.uri);
  progress(0, uris.length, 'Creating the playlist on Spotify…');
  const playlist = await client.createPlaylist({ name: draft.name, description: DJ_PLAYLIST_DESCRIPTION, uris });
  progress(uris.length, uris.length, 'Saving the set…');
  db.prepare(`UPDATE dj_sets SET status = 'created', spotify_playlist_id = ? WHERE id = ?`).run(playlist.id, draft.id);
  return playlist;
}

/**
 * Updates a created set's playlist on Spotify: replaces its tracks with the new
 * order, renames it when the name changed, and stores the new sheet. Applied
 * ticks stay only on pairs (outgoing → incoming track) that did not change;
 * Spotify may still reset Mix transitions after a reorder (ADR 0002), which the
 * UI says before the user confirms.
 */
export async function updateDjSetOnSpotify(
  db: DB,
  client: SpotifyClient,
  set: DjSetRecord,
  req: DjSpotifyUpdateRequest,
  progress: (done: number, total: number, message?: string) => void = () => {},
): Promise<{ renamed: boolean; renameFailed: boolean; changedPairs: number }> {
  const playlistId = set.spotifyPlaylistId!;
  const uris = req.result.tracks.map((t) => t.uri);
  progress(0, uris.length, 'Replacing the tracks on Spotify…');
  try {
    await client.replaceItems(playlistId, uris);
  } catch (err) {
    if (err instanceof SpotifyApiError && err.status === 404) {
      throw new Error('This playlist is no longer on Spotify. Create a new playlist instead.');
    }
    throw err;
  }

  let renamed = false;
  let renameFailed = false;
  const name = req.name.trim();
  if (name && name !== set.name) {
    progress(uris.length, uris.length, 'Renaming the playlist…');
    try {
      await client.updatePlaylistDetails(playlistId, { name });
      renamed = true;
    } catch {
      // The tracks are updated; a failed rename should not undo that.
      renameFailed = true;
    }
  }

  const key = (r: DjSetResult, i: number) => `${r.tracks[i]?.id}>${r.tracks[i + 1]?.id}`;
  const ticked = new Map(set.result.transitions.map((t, i) => [key(set.result, i), t.applied]));
  let changedPairs = 0;
  const transitions = req.result.transitions.map((t, i) => {
    const before = ticked.get(key(req.result, i));
    if (before === undefined) changedPairs++;
    return { ...t, applied: before ?? false };
  });

  progress(uris.length, uris.length, 'Saving the set…');
  db.prepare('UPDATE dj_sets SET name = ?, config_json = ?, result_json = ?, updated_at = ? WHERE id = ?').run(
    renamed ? name : set.name,
    JSON.stringify(normaliseDjConfig(req.config)),
    JSON.stringify({ ...req.result, transitions }),
    nowIso(),
    set.id,
  );
  return { renamed, renameFailed, changedPairs };
}
