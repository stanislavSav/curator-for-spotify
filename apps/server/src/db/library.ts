import type { AudioFeatures, LibraryTrack, TimeRange } from '@curator/shared';
import { getDb, type DB } from './db.ts';

/**
 * Track ids that make up "my music": Liked Songs, Owned/collaborative playlist
 * items, top tracks and recent plays. Removed playlists are excluded.
 */
export function libraryTrackIds(db: DB = getDb()): string[] {
  const rows = db
    .prepare(
      `SELECT track_id FROM liked_tracks
       UNION SELECT pi.track_id FROM playlist_items pi
         JOIN playlists p ON p.id = pi.playlist_id AND p.removed_at IS NULL
       UNION SELECT track_id FROM top_tracks
       UNION SELECT track_id FROM recent_plays`,
    )
    .all() as { track_id: string }[];
  return rows.map((r) => r.track_id);
}

interface TrackRow {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  isrc: string | null;
  album_name: string;
  release_date: string | null;
}

/** Loads full LibraryTrack rows. Omit ids to load the whole library. */
export function getLibraryTracks(db: DB = getDb(), ids?: string[]): LibraryTrack[] {
  const wanted = new Set(ids ?? libraryTrackIds(db));
  if (wanted.size === 0) return [];

  const tracks = (db.prepare('SELECT * FROM tracks').all() as TrackRow[]).filter((t) => wanted.has(t.id));

  const artistsByTrack = groupBy(
    db
      .prepare(
        `SELECT ta.track_id, a.id, a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id ORDER BY ta.position`,
      )
      .all() as { track_id: string; id: string; name: string }[],
    (r) => r.track_id,
  );

  const features = new Map(
    (db.prepare("SELECT * FROM audio_features WHERE source != 'none'").all() as Record<string, unknown>[]).map((r) => [
      r.track_id as string,
      {
        trackId: r.track_id,
        source: r.source,
        tempo: r.tempo,
        key: r.key,
        mode: r.mode,
        energy: r.energy,
        danceability: r.danceability,
        valence: r.valence,
        loudness: r.loudness,
        acousticness: r.acousticness,
        instrumentalness: r.instrumentalness,
      } as AudioFeatures,
    ]),
  );

  const tagRows = db.prepare('SELECT entity_type, entity_id, tag, weight FROM tags ORDER BY weight DESC').all() as {
    entity_type: 'track' | 'artist';
    entity_id: string;
    tag: string;
    weight: number;
  }[];
  const trackTags = groupBy(
    tagRows.filter((r) => r.entity_type === 'track'),
    (r) => r.entity_id,
  );
  const artistTags = groupBy(
    tagRows.filter((r) => r.entity_type === 'artist'),
    (r) => r.entity_id,
  );

  const liked = new Map(
    (db.prepare('SELECT track_id, added_at FROM liked_tracks').all() as { track_id: string; added_at: string }[]).map(
      (r) => [r.track_id, r.added_at],
    ),
  );
  const playlistsByTrack = groupBy(
    db
      .prepare(
        `SELECT DISTINCT pi.track_id, pi.playlist_id FROM playlist_items pi
         JOIN playlists p ON p.id = pi.playlist_id AND p.removed_at IS NULL`,
      )
      .all() as { track_id: string; playlist_id: string }[],
    (r) => r.track_id,
  );
  const topByTrack = groupBy(
    db.prepare('SELECT track_id, time_range, rank FROM top_tracks').all() as {
      track_id: string;
      time_range: TimeRange;
      rank: number;
    }[],
    (r) => r.track_id,
  );

  return tracks.map((t) => {
    const artists = (artistsByTrack.get(t.id) ?? []).map((a) => ({ id: a.id, name: a.name }));
    const tags = new Map<string, number>();
    for (const r of trackTags.get(t.id) ?? []) tags.set(r.tag, Math.max(tags.get(r.tag) ?? 0, r.weight));
    for (const a of artists)
      for (const r of artistTags.get(a.id) ?? []) tags.set(r.tag, Math.max(tags.get(r.tag) ?? 0, r.weight * 0.9));
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      durationMs: t.duration_ms,
      isrc: t.isrc,
      albumName: t.album_name,
      releaseDate: t.release_date,
      artists,
      features: features.get(t.id) ?? null,
      tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).map(([tag]) => tag),
      likedAt: liked.get(t.id) ?? null,
      playlistIds: (playlistsByTrack.get(t.id) ?? []).map((r) => r.playlist_id),
      topRanks: Object.fromEntries((topByTrack.get(t.id) ?? []).map((r) => [r.time_range, r.rank])),
    };
  });
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}
