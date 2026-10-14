import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { validateProposals, type Snapshot } from '@curator/shared';
import { openDb, ROOT_DIR, type DB } from '../db/db.ts';
import { getLibraryTracks } from '../db/library.ts';
import { enrichStatus } from '../features/enrich/status.ts';
import { knownTrackIds, ownedPlaylistTracks } from '../features/proposals/service.ts';
import { getCandidates } from '../features/prune/candidates.ts';
import { syncSummary } from '../features/sync/summary.ts';
import { DEMO_MARKER, ensureDemoData, seedDemo, type DemoSeedResult } from './seed.ts';

const NOW = new Date('2026-10-14T12:00:00Z');
const ID = /^[0-9A-Za-z]{22}$/;
let dir: string;
let result: DemoSeedResult;
let db: DB;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'curator-demo-'));
  result = seedDemo(join(dir, 'a'), NOW);
  db = openDb(join(dir, 'a', 'curator.sqlite'));
});

afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('seedDemo', () => {
  it('builds a Library of the planned size', () => {
    expect(result.tracks).toBeGreaterThanOrEqual(250);
    expect(result.tracks).toBeLessThanOrEqual(400);
    expect(result.playlists).toEqual({ owned: 11, followed: 3, generated: 1, removed: 1 });
    expect(result.recentPlays).toBe(50);
    expect(result.historyRows).toBeGreaterThan(3000);
    expect(result.snapshotTracks).toBe(result.tracks);
    const summary = syncSummary(db);
    expect(summary.libraryTracks).toBe(result.tracks);
    expect(summary.likedTracks).toBe(result.liked);
    expect(summary.lastSuccessAt).not.toBeNull();
  });

  it('uses 22-character ids and real-looking rows', () => {
    for (const table of ['tracks', 'artists', 'playlists'])
      for (const id of db.prepare(`SELECT id FROM ${table}`).pluck().all() as string[]) expect(id, table).toMatch(ID);
    const tracks = getLibraryTracks(db);
    const genres = new Set(tracks.flatMap((t) => t.tags.slice(0, 1)));
    expect(genres.size).toBeGreaterThanOrEqual(8);
    expect(tracks.filter((t) => t.features?.tempo != null).length / tracks.length).toBeGreaterThan(0.85);
    const liked = (db.prepare('SELECT added_at FROM liked_tracks').pluck().all() as string[]).map((d) => Date.parse(d));
    expect(Math.min(...liked)).toBeGreaterThanOrEqual(Date.parse('2018-01-01'));
    expect(Math.max(...liked)).toBeLessThanOrEqual(NOW.getTime());
  });

  it('gives Prune candidates, keepers and an empty playlist', () => {
    const c = getCandidates(db, 12, NOW);
    const group = (name: string) => c.playlists.find((p) => p.name === name)?.group;
    expect(c.history.rows).toBe(result.historyRows);
    for (const name of ['Gym 2019', "Road Trip '21", 'Wedding Party Ideas', 'Britpop Summer', 'Chill Finds', 'My Playlist #7'])
      expect(group(name), name).toBe('candidate');
    for (const name of ['Indie Mix', 'House Selects', 'Late Night', 'Focus', 'Sunday Records', 'Jazz Vinyl Classics'])
      expect(group(name), name).toBe('keep');
    expect(c.excludedGenerated).toBe(1);
  });

  it('makes the Library page coverage look finished but not perfect', () => {
    const s = enrichStatus(db, NOW);
    for (const source of s.sources) expect(source.waiting, source.label).toBe(0);
    expect(s.sources.find((x) => x.id === 'spotify-genre')?.state).toBe('unavailable');
    expect(s.gaps.noBpm).toBeGreaterThan(0);
    expect(s.gaps.noBpm).toBeLessThan(s.gaps.tracks * 0.1);
  });

  it('writes a Snapshot and a valid proposals file whose tracks all exist', () => {
    const snapshot = JSON.parse(readFileSync(join(dir, 'a', 'snapshot.json'), 'utf8')) as Snapshot;
    expect(snapshot.user).toBe('Demo listener');
    const text = readFileSync(join(dir, 'a', 'proposals.json'), 'utf8');
    const known = knownTrackIds(db);
    const v = validateProposals(text, {
      isKnownTrack: (id) => known.has(id),
      snapshotGeneratedAt: snapshot.generatedAt,
      ownedPlaylists: ownedPlaylistTracks(db),
    });
    expect(v.usable).toBe(true);
    expect(v.errors).toEqual([]);
    expect(v.warnings).toEqual([]);
    expect(v.file!.proposals.length).toBe(result.proposals);
  });

  it('keeps the Rediscover promise: liked, in no Owned Playlist, unplayed for 12 months', () => {
    const file = JSON.parse(readFileSync(join(dir, 'a', 'proposals.json'), 'utf8')) as { proposals: { id: string; tracks: { id: string }[] }[] };
    const ids = file.proposals.find((p) => p.id === 'rediscover-liked-not-played')!.tracks.map((t) => t.id);
    const owned = new Set(ownedPlaylistTracks(db).flatMap((p) => p.trackIds));
    const yearAgo = new Date(NOW);
    yearAgo.setUTCFullYear(yearAgo.getUTCFullYear() - 1);
    for (const id of ids) {
      expect(db.prepare('SELECT 1 FROM liked_tracks WHERE track_id = ?').get(id), id).toBeDefined();
      expect(owned.has(id), id).toBe(false);
      expect(db.prepare('SELECT COUNT(*) FROM stream_history WHERE track_uri = ? AND ts >= ?').pluck().get(`spotify:track:${id}`, yearAgo.toISOString())).toBe(0);
    }
  });

  it('is deterministic for the same now', () => {
    seedDemo(join(dir, 'b'), NOW);
    const other = openDb(join(dir, 'b', 'curator.sqlite'));
    const dump = (d: DB) =>
      JSON.stringify([
        d.prepare('SELECT * FROM liked_tracks ORDER BY track_id').all(),
        d.prepare('SELECT * FROM playlist_items ORDER BY playlist_id, position').all(),
        d.prepare('SELECT COUNT(*), MIN(ts), MAX(ts), SUM(ms_played) FROM stream_history').get(),
      ]);
    expect(dump(other)).toBe(dump(db));
    other.close();
    expect(readFileSync(join(dir, 'b', 'proposals.json'), 'utf8')).toBe(readFileSync(join(dir, 'a', 'proposals.json'), 'utf8'));
  });
});

describe('ensureDemoData', () => {
  it('refuses the real data folder', () => {
    expect(() => ensureDemoData(resolve(ROOT_DIR, 'data'), NOW)).toThrow(/own data folder/);
  });

  it('refuses a folder with a Library it did not make', () => {
    const d = join(dir, 'foreign');
    openDb(join(d, 'curator.sqlite')).close();
    expect(() => ensureDemoData(d, NOW)).toThrow(/did not make/);
  });

  it('seeds once, then reseeds only when the seed is old', () => {
    const d = join(dir, 'ensure');
    expect(ensureDemoData(d, NOW)).not.toBeNull();
    expect(ensureDemoData(d, new Date(NOW.getTime() + 86_400_000))).toBeNull();
    const marker = JSON.parse(readFileSync(join(d, DEMO_MARKER), 'utf8')) as { seededAt: string };
    writeFileSync(join(d, DEMO_MARKER), JSON.stringify({ ...marker, version: 1, seededAt: '2026-01-01T00:00:00Z' }));
    expect(ensureDemoData(d, NOW)).not.toBeNull();
  });
});
