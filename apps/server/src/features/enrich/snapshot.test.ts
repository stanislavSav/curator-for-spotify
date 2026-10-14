import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DB } from '../../db/db.ts';
import { coverage, libraryRows, queryLibrary } from './library-view.ts';
import { buildSnapshot, serializeSnapshot, writeSnapshot } from './snapshot.ts';
import { replaceTags } from './store.ts';
import { seedDb, sid } from './test-fixtures.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const A = { id: sid('artistA'), name: 'Alpha' };
const B = { id: sid('artistB'), name: 'Beta' };

function seed(): DB {
  const db = seedDb(
    [
      { id: sid('t1'), name: 'One', artists: [A], liked: '2026-05-01T10:00:00Z', release: '1999-03-01', durationMs: 200_400 },
      { id: sid('t2'), name: 'Two', artists: [A, B], liked: '2026-09-01T10:00:00Z', release: '2020' },
      { id: sid('t3'), name: 'Three', artists: [B] },
    ],
    { connected: true },
  );
  db.prepare("DELETE FROM liked_tracks WHERE track_id = ?").run(sid('t3'));
  db.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, kind, items_readable, items_total, snapshot_id, synced_at, library_position)
     VALUES ('p1', 'Mine', 'Late night', 'user1', 'owned', 1, 2, 's', '2026-10-01', 0),
            ('p2', 'Theirs', '', 'other', 'followed', 0, 50, 's', '2026-10-01', 1),
            ('p3', 'Gone', '', 'user1', 'owned', 1, 1, 's', '2026-10-01', 2)`,
  ).run();
  db.prepare("UPDATE playlists SET removed_at = '2026-10-02' WHERE id = 'p3'").run();
  db.prepare("INSERT INTO playlist_items (playlist_id, position, track_id) VALUES ('p1', 0, ?), ('p1', 1, ?)").run(sid('t3'), sid('t1'));
  db.prepare("INSERT INTO top_tracks (time_range, rank, track_id) VALUES ('short_term', 3, ?), ('long_term', 1, ?)").run(sid('t1'), sid('t1'));
  db.prepare("INSERT INTO top_artists (time_range, rank, artist_id) VALUES ('medium_term', 2, ?), ('medium_term', 1, ?)").run(A.id, B.id);
  db.prepare(
    `INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, danceability, valence, acousticness, instrumentalness, fetched_at)
     VALUES (?, 'reccobeats', 123.456, 9, 0, 0.8123, 0.5, 0.333, 0.01, 0.0001, 'x'), (?, 'deezer', 99.5, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'x')`,
  ).run(sid('t1'), sid('t2'));
  replaceTags(db, 'artist', A.id, 'musicbrainz', ['house', 'disco', 'funk', 'soul', 'jazz', 'pop', 'rock'].map((tag, i) => ({ tag, weight: 1 - i / 10 })));
  replaceTags(db, 'artist', B.id, 'spotify-genre', [{ tag: 'techno', weight: 1 }]);
  const uri = (id: string) => `spotify:track:${id}`;
  const play = db.prepare('INSERT INTO stream_history (ts, track_uri, ms_played) VALUES (?, ?, ?)');
  play.run('2026-10-01T20:00:00Z', uri(sid('t1')), 180_000);
  play.run('2026-03-01T20:00:00Z', uri(sid('t1')), 31_000);
  play.run('2026-03-02T20:00:00Z', uri(sid('t1')), 5_000); // skip: < 30 s
  play.run('2025-01-01T20:00:00Z', uri(sid('t1')), 200_000); // older than 12 months
  play.run('2024-06-01T20:00:00Z', uri(sid('t3')), 200_000);
  return db;
}

describe('buildSnapshot', () => {
  it('produces the Snapshot contract', () => {
    const s = buildSnapshot(seed(), NOW);
    expect(s.version).toBe(1);
    expect(s.generatedAt).toBe(NOW.toISOString());
    expect(s.user).toBe('Test User');
    expect(s.coverage).toEqual({ tracks: 3, withFeatures: 2, withTags: 3, withHistory: 2 });
    expect(s.playlists).toEqual([
      { id: 'p1', name: 'Mine', kind: 'owned', n: 2, desc: 'Late night' },
      { id: 'p2', name: 'Theirs', kind: 'followed', n: 50 },
    ]);
    expect(s.topArtists).toEqual({ s: [], m: ['Beta', 'Alpha'], l: [] });

    // Liked newest first, then unliked.
    expect(s.tracks.map((t) => t.name)).toEqual(['Two', 'One', 'Three']);
    const one = s.tracks[1]!;
    expect(one).toEqual({
      id: sid('t1'),
      name: 'One',
      artists: ['Alpha'],
      year: 1999,
      dur: 200,
      liked: '2026-05-01',
      pl: ['p1'],
      top: { s: 3, l: 1 },
      plays12m: 2,
      lastPlayed: '2026-10-01',
      bpm: 123.46,
      cam: '8A',
      energy: 0.81,
      valence: 0.33,
      dance: 0.5,
      acoustic: 0.01,
      instr: 0,
      tags: ['house', 'disco', 'funk', 'soul', 'jazz', 'pop'],
    });
    expect(s.tracks[0]).toMatchObject({ name: 'Two', year: 2020, bpm: 99.5 });
    expect(s.tracks[0]!.cam).toBeUndefined();
    expect(s.tracks[2]).toMatchObject({ name: 'Three', lastPlayed: '2024-06-01', tags: ['techno'] });
    expect(s.tracks[2]!.plays12m).toBeUndefined();
    expect(s.tagCounts.slice(0, 2)).toEqual([['disco', 2], ['funk', 2]]);
    expect(s.tagCounts.find(([t]) => t === 'techno')).toEqual(['techno', 2]);
  });

  it('works with an empty Library and no history', () => {
    const s = buildSnapshot(seedDb([]), NOW);
    expect(s.tracks).toEqual([]);
    expect(s.coverage).toEqual({ tracks: 0, withFeatures: 0, withTags: 0, withHistory: 0 });
    expect(s.user).toBe('');
  });

  it('serialises to valid JSON with one line per track', () => {
    const s = buildSnapshot(seed(), NOW);
    const text = serializeSnapshot(s);
    expect(JSON.parse(text)).toEqual(s);
    const trackLines = text.split('\n').filter((l) => l.startsWith('    {"id":"'));
    expect(trackLines).toHaveLength(s.tracks.length + s.playlists.length);
    expect(JSON.parse(serializeSnapshot(buildSnapshot(seedDb([]), NOW)))).toMatchObject({ tracks: [], playlists: [] });

    const file = join(mkdtempSync(join(tmpdir(), 'snap-')), 'snapshot.json');
    const bytes = writeSnapshot(s, file);
    expect(readFileSync(file, 'utf8')).toBe(text);
    expect(coverage(seed(), file, NOW).snapshot).toEqual({ generatedAt: NOW.toISOString(), tracks: 3, bytes });
  });
});

describe('Library table', () => {
  it('sorts with empty values last, filters and pages', () => {
    const rows = libraryRows(seed(), NOW);
    const names = (q: Parameters<typeof queryLibrary>[1]) => queryLibrary(rows, q).rows.map((r) => r.name);
    expect(names({ sort: 'bpm' })).toEqual(['Two', 'One', 'Three']);
    expect(names({ sort: 'bpm', dir: 'desc' })).toEqual(['One', 'Two', 'Three']);
    expect(names({ sort: 'liked', dir: 'desc' })).toEqual(['Two', 'One', 'Three']);
    expect(names({ missing: 'features' })).toEqual(['Three']);
    expect(names({ missing: 'tags' })).toEqual([]);
    expect(names({ q: 'beta techno' })).toEqual(['Two', 'Three']);
    expect(queryLibrary(rows, { limit: 1, offset: 1, sort: 'name' })).toMatchObject({ total: 3, offset: 1, limit: 1 });
    expect(names({ limit: 1, offset: 1, sort: 'name' })).toEqual(['Three']);
  });

  it('builds rows with Camelot, energy and indicators', () => {
    const one = libraryRows(seed(), NOW).find((r) => r.row.name === 'One')!.row;
    expect(one).toMatchObject({
      bpm: 123.46,
      camelot: '8A',
      keyName: 'Am',
      energy: 0.81,
      featuresSource: 'reccobeats',
      topRank: 1,
      playlists: 1,
      plays12m: 2,
    });
  });

  it('reports coverage', () => {
    const c = coverage(seed(), '/nonexistent/snapshot.json', NOW);
    expect(c).toMatchObject({
      tracks: 3,
      withFeatures: 2,
      withBpm: 2,
      withKey: 1,
      withEnergy: 1,
      withTags: 3,
      featuresBySource: { reccobeats: 1, deezer: 1, manual: 0 },
      artists: 2,
      artistTagsBySource: { spotifyGenre: 1, musicbrainz: 1 },
      spotifyGenresStripped: false,
      history: { rows: 5, plays12m: 2, tracksWithPlays: 2 },
      snapshot: null,
    });
  });
});
