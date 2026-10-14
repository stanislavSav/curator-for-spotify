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
} from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';
import type { SpotifyClient } from '../../spotify/client.ts';
import { parseCamelot } from './harmony.ts';
import { AUTO, suggestTransition } from './transitions.ts';

interface Row {
  id: string;
  name: string;
  config_json: string;
  result_json: string;
  spotify_playlist_id: string | null;
  created_at: string;
}

const playlistUrl = (id: string | null) => (id ? `https://open.spotify.com/playlist/${id}` : null);

const end = (t: DjSetTrack) => ({ bpm: t.bpm, camelot: parseCamelot(t.camelot), energy: t.energy });

/**
 * Sets saved before task 006 have transitions without settings (style, bars,
 * eqHint, cutHint). They get fresh suggestions from the stored tracks; when the
 * tracks are missing, Auto.
 */
function normaliseTransition(raw: unknown, i: number, tracks: DjSetTrack[], cfg: DjSetConfig): DjTransition {
  const t = (raw && typeof raw === 'object' ? raw : {}) as Partial<DjTransition>;
  if (t.settings && typeof t.settings === 'object') {
    return { ...t, suggested: t.suggested ?? t.settings, applied: t.applied === true } as DjTransition;
  }
  const a = tracks[i];
  const b = tracks[i + 1];
  if (a && b && a.bpm > 0 && b.bpm > 0) return suggestTransition(end(a), end(b), cfg);
  return {
    settings: { ...AUTO },
    suggested: { ...AUTO },
    bpmDeltaPct: t.bpmDeltaPct ?? 0,
    keyRelation: t.keyRelation ?? 'unknown',
    energyDelta: t.energyDelta ?? null,
    reason: t.reason ?? '',
    applied: false,
  };
}

function toRecord(r: Row): DjSetRecord {
  const config = normaliseDjConfig(JSON.parse(r.config_json));
  const stored = JSON.parse(r.result_json) as DjSetResult;
  const tracks = stored.tracks ?? [];
  const result: DjSetResult = {
    ...stored,
    tracks,
    transitions: (stored.transitions ?? []).map((t, i) => normaliseTransition(t, i, tracks, config)),
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
  db.prepare('UPDATE dj_sets SET result_json = ? WHERE id = ?').run(JSON.stringify(set.result), id);
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
