// Test-only builders for the dj feature.
import { DEFAULT_DJ_CONFIG, toCamelot, type DjSetConfig, type LibraryTrack } from '@curator/shared';
import type { DB } from '../../db/db.ts';
import type { DjCandidate } from './order.ts';

export function cand(id: string, bpm: number, cam: [number, 0 | 1] | null, energy: number | null, artist = `ar-${id}`): DjCandidate {
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Track ${id}`,
    artistIds: [artist],
    artistNames: [artist],
    durationMs: 200_000,
    bpm,
    camelot: cam ? toCamelot(cam[0], cam[1]) : null,
    energy,
    valence: null,
    danceability: null,
    instrumentalness: null,
    acousticness: null,
    tags: [],
  };
}

export function config(over: Partial<DjSetConfig> = {}): DjSetConfig {
  return structuredClone({ ...DEFAULT_DJ_CONFIG, ...over });
}

export function libTrack(id: string, over: Partial<LibraryTrack> & { tempo?: number | null; energy?: number | null; key?: number | null; mode?: 0 | 1 | null } = {}): LibraryTrack {
  const { tempo = 120, energy = 0.6, key = 0, mode = 1, ...rest } = over;
  return {
    id,
    uri: `spotify:track:${id}`,
    name: `Track ${id}`,
    durationMs: 200_000,
    isrc: null,
    albumName: '',
    releaseDate: '2015-01-01',
    artists: [{ id: `ar-${id}`, name: `Artist ${id}` }],
    features:
      tempo == null && energy == null
        ? null
        : {
            trackId: id,
            source: 'reccobeats',
            tempo,
            key,
            mode,
            energy,
            danceability: null,
            valence: null,
            loudness: null,
            acousticness: null,
            instrumentalness: null,
          },
    tags: [],
    likedAt: null,
    playlistIds: [],
    topRanks: {},
    ...rest,
  };
}

/** Inserts a small Library: playlist pl1 with tracks, each liked, with features. */
export function seedLibrary(db: DB, tracks: { id: string; tempo: number | null; key: number; mode: 0 | 1; energy: number }[]) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO playlists (id, name, owner_id, kind, items_readable, items_total, snapshot_id, synced_at, library_position)
     VALUES ('pl1', 'Warm-up', 'me', 'owned', 1, ?, 's1', ?, 0)`,
  ).run(tracks.length, now);
  tracks.forEach((t, i) => {
    db.prepare(`INSERT INTO tracks (id, uri, name, duration_ms, release_date) VALUES (?, ?, ?, 200000, '2012-05-01')`).run(
      t.id,
      `spotify:track:${t.id}`,
      `Track ${t.id}`,
    );
    db.prepare(`INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)`).run(`ar-${t.id}`, `Artist ${t.id}`);
    db.prepare(`INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, 0)`).run(t.id, `ar-${t.id}`);
    db.prepare(`INSERT INTO playlist_items (playlist_id, position, track_id) VALUES ('pl1', ?, ?)`).run(i, t.id);
    db.prepare(`INSERT INTO liked_tracks (track_id, added_at) VALUES (?, ?)`).run(t.id, now);
    db.prepare(
      `INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, fetched_at) VALUES (?, 'reccobeats', ?, ?, ?, ?, ?)`,
    ).run(t.id, t.tempo, t.key, t.mode, t.energy, now);
  });
}
