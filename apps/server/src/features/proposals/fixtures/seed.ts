import { readFileSync } from 'node:fs';
import { nowIso, type DB } from '../../../db/db.ts';

export interface SampleTrack {
  id: string;
  name: string;
  artists: string[];
  year: number;
  durationMs: number;
  bpm: number | null;
  key: number;
  mode: 0 | 1;
  energy: number;
  tags: string[];
  likedAt: string | null;
}

export const SAMPLE_LIBRARY = new URL('./library.sample.json', import.meta.url);
export const SAMPLE_PROPOSALS = new URL('./proposals.sample.json', import.meta.url);

export const sampleTracks = (): SampleTrack[] =>
  (JSON.parse(readFileSync(SAMPLE_LIBRARY, 'utf8')) as { tracks: SampleTrack[] }).tracks;

const artistId = (name: string) => `fixartist${name.replace(/[^0-9A-Za-z]/g, '').slice(0, 13).padEnd(13, '0')}`;

/**
 * Inserts the sample tracks (with artists, audio features and tags). With
 * `liked`, they also go into Liked Songs, which makes them part of the Library.
 */
export function seedSampleLibrary(db: DB, opts: { liked?: boolean } = {}) {
  const tracks = sampleTracks();
  const now = nowIso();
  const insTrack = db.prepare(
    'INSERT OR IGNORE INTO tracks (id, uri, name, duration_ms, album_name, release_date) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insArtist = db.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)');
  const insTa = db.prepare('INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)');
  const insFeat = db.prepare(
    `INSERT OR IGNORE INTO audio_features (track_id, source, tempo, key, mode, energy, fetched_at)
     VALUES (?, 'manual', ?, ?, ?, ?, ?)`,
  );
  const insTag = db.prepare(
    "INSERT OR IGNORE INTO tags (entity_type, entity_id, source, tag, weight) VALUES ('track', ?, 'musicbrainz', ?, ?)",
  );
  const insLiked = db.prepare('INSERT OR IGNORE INTO liked_tracks (track_id, added_at) VALUES (?, ?)');
  db.transaction(() => {
    for (const t of tracks) {
      insTrack.run(t.id, `spotify:track:${t.id}`, t.name, t.durationMs, `${t.name} (sample)`, `${t.year}-01-01`);
      t.artists.forEach((a, i) => {
        insArtist.run(artistId(a), a);
        insTa.run(t.id, artistId(a), i);
      });
      insFeat.run(t.id, t.bpm, t.key, t.mode, t.energy, now);
      t.tags.forEach((tag, i) => insTag.run(t.id, tag, 1 - i * 0.1));
      if (opts.liked && t.likedAt) insLiked.run(t.id, t.likedAt);
    }
  })();
  return tracks;
}
