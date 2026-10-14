import { DJ_PLAYLIST_DESCRIPTION, type DjCreateRequest, type DjSetRecord, type DjSetSummary } from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';
import type { SpotifyClient } from '../../spotify/client.ts';

interface Row {
  id: string;
  name: string;
  config_json: string;
  result_json: string;
  spotify_playlist_id: string | null;
  created_at: string;
}

const playlistUrl = (id: string | null) => (id ? `https://open.spotify.com/playlist/${id}` : null);

function toRecord(r: Row): DjSetRecord {
  const result = JSON.parse(r.result_json) as DjSetRecord['result'];
  return {
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    tracks: result.tracks.length,
    durationMs: result.durationMs,
    score: result.score.total,
    spotifyPlaylistId: r.spotify_playlist_id,
    spotifyUrl: playlistUrl(r.spotify_playlist_id),
    config: JSON.parse(r.config_json),
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
