import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { openDb, type DB } from '../../db/db.ts';
import {
  collectHistoryFiles,
  historySummary,
  importHistory,
  normalizeTitle,
  parseExtendedRow,
  parseHistoryFiles,
  parseLegacyRow,
} from './history.ts';

const ext = (over: Record<string, unknown> = {}) => ({
  ts: '2024-05-01T10:00:00Z',
  platform: 'iOS',
  ms_played: 200000,
  conn_country: 'DE',
  master_metadata_track_name: 'Song',
  master_metadata_album_artist_name: 'Artist',
  spotify_track_uri: 'spotify:track:aaa',
  spotify_episode_uri: null,
  audiobook_uri: null,
  reason_start: 'clickrow',
  reason_end: 'trackdone',
  shuffle: false,
  skipped: null,
  offline: false,
  incognito_mode: false,
  ...over,
});

const json = (name: string, rows: unknown) => ({ name, data: strToU8(JSON.stringify(rows)) });

function seedTrack(db: DB, id: string, name: string, artist: string) {
  db.prepare("INSERT INTO tracks (id, uri, name, duration_ms) VALUES (?, ?, ?, 1000)").run(id, `spotify:track:${id}`, name);
  db.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)').run(`ar-${artist}`, artist);
  db.prepare('INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, 0)').run(id, `ar-${artist}`);
}

describe('parseExtendedRow', () => {
  it('reads the extended fields', () => {
    expect(parseExtendedRow(ext({ shuffle: true, skipped: false }))).toEqual({
      ts: '2024-05-01T10:00:00Z',
      trackUri: 'spotify:track:aaa',
      msPlayed: 200000,
      reasonStart: 'clickrow',
      reasonEnd: 'trackdone',
      shuffle: 1,
      skipped: 0,
      platform: 'iOS',
    });
  });

  it('skips podcasts, audiobooks and rows without a track URI', () => {
    expect(parseExtendedRow(ext({ spotify_track_uri: null, spotify_episode_uri: 'spotify:episode:x' }))).toBeNull();
    expect(parseExtendedRow(ext({ spotify_track_uri: null }))).toBeNull();
    expect(parseExtendedRow(ext({ ts: 'garbage' }))).toBeNull();
  });
});

describe('parseLegacyRow', () => {
  it('turns endTime (UTC, minutes) into ISO', () => {
    expect(parseLegacyRow({ endTime: '2023-01-05 14:32', artistName: 'A', trackName: 'T', msPlayed: 5000 })).toEqual({
      ts: '2023-01-05T14:32:00Z',
      artist: 'A',
      title: 'T',
      msPlayed: 5000,
    });
  });
});

describe('normalizeTitle', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeTitle('  Beyoncé — Halo! ')).toBe('beyonce halo');
  });
});

describe('collectHistoryFiles', () => {
  it('takes only Streaming History music files from a zip, in any folder', () => {
    const zip = zipSync({
      'Spotify Extended Streaming History/Streaming_History_Audio_2023-2024_1.json': strToU8('[]'),
      'Spotify Extended Streaming History/Streaming_History_Audio_2016-2017_0.json': strToU8('[]'),
      'Spotify Extended Streaming History/Streaming_History_Video_2017-2026.json': strToU8('[]'),
      'Spotify Extended Streaming History/ReadMeFirst_ExtendedStreamingHistory.pdf': strToU8('x'),
      'Spotify Account Data/StreamingHistory_music_0.json': strToU8('[]'),
      'Spotify Account Data/StreamingHistory_podcast_0.json': strToU8('[]'),
      'Spotify Account Data/Playlist1.json': strToU8('{}'),
    });
    const files = collectHistoryFiles([{ name: 'my_spotify_data.zip', data: zip }]);
    expect(files.map((f) => f.name)).toEqual([
      'Streaming_History_Audio_2016-2017_0.json',
      'Streaming_History_Audio_2023-2024_1.json',
      'StreamingHistory_music_0.json',
    ]);
  });

  it('keeps plain json uploads', () => {
    expect(collectHistoryFiles([json('x.json', []), { name: 'a.txt', data: strToU8('') }])).toHaveLength(1);
  });
});

describe('parseHistoryFiles', () => {
  it('detects the format per row and counts skips', () => {
    const p = parseHistoryFiles([
      json('a.json', [ext(), ext({ spotify_track_uri: null }), { hello: 1 }]),
      json('b.json', [{ endTime: '2023-01-05 14:32', artistName: 'A', trackName: 'T', msPlayed: 5000 }]),
    ]);
    expect(p.rowsRead).toBe(4);
    expect(p.extended).toHaveLength(1);
    expect(p.legacy).toHaveLength(1);
    expect(p.skipped).toBe(2);
    expect(p.files.map((f) => f.format)).toEqual(['extended', 'legacy']);
  });

  it('rejects invalid JSON with the file name', () => {
    expect(() => parseHistoryFiles([{ name: 'bad.json', data: strToU8('{') }])).toThrow(/bad.json/);
  });
});

describe('importHistory', () => {
  it('inserts new rows, ignores duplicates and reports the range', async () => {
    const db = openDb(':memory:');
    const file = json('Streaming_History_Audio_2024_0.json', [
      ext(),
      ext({ ts: '2024-06-01T10:00:00Z', spotify_track_uri: 'spotify:track:bbb' }),
      ext({ spotify_track_uri: null, spotify_episode_uri: 'spotify:episode:p' }),
    ]);
    const first = await importHistory(db, [file]);
    expect(first).toMatchObject({ rowsRead: 3, inserted: 2, duplicates: 0, skipped: 1, legacy: null });
    expect(first.firstTs).toBe('2024-05-01T10:00:00Z');
    expect(first.lastTs).toBe('2024-06-01T10:00:00Z');

    const again = await importHistory(db, [file]);
    expect(again).toMatchObject({ inserted: 0, duplicates: 2 });
  });

  it('matches legacy rows to library tracks by artist + title and skips plays the extended history has', async () => {
    const db = openDb(':memory:');
    seedTrack(db, 'aaa', 'Song', 'Artist');
    seedTrack(db, 'ccc', 'Other Song', 'Band');
    const result = await importHistory(db, [
      json('Streaming_History_Audio_2024_0.json', [ext({ ts: '2024-05-01T10:00:30Z' })]),
      json('StreamingHistory_music_0.json', [
        { endTime: '2024-05-01 10:00', artistName: 'artist', trackName: 'SONG', msPlayed: 200000 }, // same play
        { endTime: '2024-05-02 09:00', artistName: 'Band', trackName: 'Other Song', msPlayed: 100000 },
        { endTime: '2024-05-02 09:05', artistName: 'Nobody', trackName: 'Unknown', msPlayed: 100000 },
      ]),
    ]);
    expect(result.legacy).toEqual({ rows: 3, matched: 2, unmatched: 1 });
    expect(result.inserted).toBe(2);
    const rows = db.prepare('SELECT ts, track_uri FROM stream_history ORDER BY ts').all();
    expect(rows).toEqual([
      { ts: '2024-05-01T10:00:30Z', track_uri: 'spotify:track:aaa' },
      { ts: '2024-05-02T09:00:00Z', track_uri: 'spotify:track:ccc' },
    ]);
  });

  it('reports progress per chunk', async () => {
    const db = openDb(':memory:');
    const rows = Array.from({ length: 5 }, (_, i) => ext({ ts: `2024-05-0${i + 1}T10:00:00Z` }));
    const calls: number[] = [];
    await importHistory(db, [json('h.json', rows)], { chunkSize: 2, onProgress: (d) => void calls.push(d) });
    expect(calls).toEqual([2, 4, 5]);
  });

  it('fails clearly when there are no history files', async () => {
    await expect(importHistory(openDb(':memory:'), [{ name: 'x.txt', data: strToU8('') }])).rejects.toThrow(
      /No Streaming History files/,
    );
  });
});

describe('historySummary', () => {
  it('counts rows, range, distinct tracks and the matched share', async () => {
    const db = openDb(':memory:');
    seedTrack(db, 'aaa', 'Song', 'Artist');
    await importHistory(db, [
      json('h.json', [
        ext(),
        ext({ ts: '2024-05-02T10:00:00Z' }),
        ext({ ts: '2024-07-01T10:00:00Z', spotify_track_uri: 'spotify:track:zzz' }),
      ]),
    ]);
    expect(historySummary(db)).toEqual({
      rows: 3,
      firstTs: '2024-05-01T10:00:00Z',
      lastTs: '2024-07-01T10:00:00Z',
      distinctTracks: 2,
      matchedTracks: 1,
      matchedPct: 50,
    });
  });

  it('is empty before any import', () => {
    expect(historySummary(openDb(':memory:'))).toMatchObject({ rows: 0, firstTs: null, matchedPct: 0 });
  });
});
