import {
  DJ_PLAYLIST_DESCRIPTION,
  normaliseDjConfig,
  type DjCreateRequest,
  type DjSetConfig,
  type DjSetRecord,
  type DjSetResult,
  type DjSetSummary,
  type DjSetTrack,
  type DjTransition,
  type DjTransitionPatch,
  type TransitionSettings,
  toBars,
} from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';
import type { SpotifyClient } from '../../spotify/client.ts';
import { parseCamelot } from './harmony.ts';
import { AUTO, likelyNoBeatGrid, setPositions, suggestTransition, type SetPosition, type TransitionEnd } from './transitions.ts';

interface Row {
  id: string;
  name: string;
  config_json: string;
  result_json: string;
  spotify_playlist_id: string | null;
  created_at: string;
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

export function saveDjSet(db: DB, id: string, req: DjCreateRequest, spotifyPlaylistId: string | null) {
  db.prepare(
    `INSERT INTO dj_sets (id, name, config_json, result_json, spotify_playlist_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, req.name, JSON.stringify(req.config), JSON.stringify(req.result), spotifyPlaylistId, nowIso());
}

export function getDjSet(db: DB, id: string): DjSetRecord | null {
  const row = db.prepare('SELECT * FROM dj_sets WHERE id = ?').get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function listDjSets(db: DB): DjSetSummary[] {
  const rows = db.prepare('SELECT * FROM dj_sets ORDER BY created_at DESC').all() as Row[];
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

export function saveDjSetResult(db: DB, id: string, result: DjSetResult): DjSetRecord | null {
  db.prepare('UPDATE dj_sets SET result_json = ? WHERE id = ?').run(JSON.stringify(result), id);
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
