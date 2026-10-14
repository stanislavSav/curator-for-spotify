import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LIBRARY_TABLES, conflictChoiceKey, parseFullBackup, type FullBackup } from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { FullBackupError, applyImport, exportFullBackup, previewImport, readWork } from './service.ts';

// Fake ids and well-known public songs only.
const ACCESS = 'fake-access-token-never-exported';
const REFRESH = 'fake-refresh-token-never-exported';

const dirs: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'curator-full-backup-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const proposalsFile = (n: number) =>
  JSON.stringify({ version: 1, generatedAt: '2026-10-01T10:00:00Z', proposals: Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, name: `Fake ${i}` })) });

const backupJson = (playlistId: string, name: string, createdAt: string, uris: string[]) =>
  JSON.stringify({ version: 1, playlistId, uri: `spotify:playlist:${playlistId}`, name, description: '', kind: 'owned', owner: { id: 'u1', name: 'Fake' }, public: false, collaborative: false, createdAt, tracksFrom: 'database', uris });

function seedLibrary(db: DB) {
  db.prepare("INSERT INTO tracks (id, uri, name, duration_ms, album_name) VALUES ('t1', 'spotify:track:t1', 'Around the World', 429000, 'Homework')").run();
  db.prepare("INSERT INTO tracks (id, uri, name, duration_ms, album_name) VALUES ('t2', 'spotify:track:t2', 'One More Time', 320000, 'Discovery')").run();
  db.prepare("INSERT INTO artists (id, name, genres_json) VALUES ('a1', 'Daft Punk', '[\"french house\"]')").run();
  db.prepare("INSERT INTO track_artists VALUES ('t1', 'a1', 0), ('t2', 'a1', 0)").run();
  db.prepare(
    "INSERT INTO playlists (id, name, owner_id, kind, items_readable, snapshot_id, synced_at) VALUES ('pl1', 'Fake House', 'u1', 'owned', 1, 's1', '2026-10-01')",
  ).run();
  db.prepare("INSERT INTO playlist_items (playlist_id, position, track_id) VALUES ('pl1', 0, 't1'), ('pl1', 1, 't2')").run();
  db.prepare("INSERT INTO liked_tracks VALUES ('t2', '2026-01-01')").run();
  db.prepare("INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, fetched_at) VALUES ('t1', 'manual', 121.5, 7, 1, 0.8, '2026-10-01')").run();
  db.prepare("INSERT INTO tags VALUES ('track', 't1', 'manual', 'house', 1)").run();
  db.prepare("INSERT INTO stream_history (ts, track_uri, ms_played) VALUES ('2025-01-01T00:00:00Z', 'spotify:track:t1', 60000)").run();
}

function seedWork(db: DB, dataDir: string) {
  db.prepare(
    "INSERT INTO auth VALUES (1, ?, ?, 0, 'scope', 'u1', 'Fake', '2026-10-01')",
  ).run(ACCESS, REFRESH);
  db.prepare("INSERT INTO jobs (id, kind, status, started_at) VALUES ('j1', 'sync', 'done', '2026-10-01')").run();
  db.prepare(
    "INSERT INTO dj_templates VALUES ('tpl1', 'Friday warm-up', 0, '{\"curve\":\"build\"}', '2026-10-01', '2026-10-02')",
  ).run();
  db.prepare(
    `INSERT INTO dj_sets (id, name, config_json, result_json, spotify_playlist_id, created_at, status, updated_at)
     VALUES ('set1', 'Draft set', '{}', '{"tracks":[{"id":"t1"}],"edits":{"0":"fade"}}', NULL, '2026-10-03', 'draft', '2026-10-04'),
            ('set2', 'Created set', '{}', '{"tracks":[]}', 'pl-new', '2026-10-01', 'created', NULL)`,
  ).run();
  db.prepare("INSERT INTO proposal_state VALUES ('p-0', 'approved', '{\"name\":\"Edited\"}', NULL, '2026-10-05')").run();
  db.prepare("INSERT INTO backups (id, playlist_id, name, created_at, json) VALUES (1, 'old1', 'Old One', '2026-09-01T00:00:00Z', ?)").run(
    backupJson('old1', 'Old One', '2026-09-01T00:00:00Z', ['spotify:track:t1']),
  );
  db.prepare("INSERT INTO prune_log VALUES ('old1', 'owned', '2026-09-01T00:00:01Z', 1)").run();
  db.prepare("INSERT INTO backup_restores VALUES (1, '2026-09-10', 'recreated', 'pl-r', 'https://open.spotify.com/playlist/pl-r')").run();
  writeFileSync(join(dataDir, 'proposals.json'), proposalsFile(2));
}

function libraryRows(db: DB) {
  return Object.fromEntries(LIBRARY_TABLES.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
}

const roundTrip = (backup: FullBackup) => {
  const parsed = parseFullBackup(JSON.parse(JSON.stringify(backup)));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.backup;
};

function source() {
  const db = openDb(':memory:');
  const dir = tempDir();
  seedLibrary(db);
  seedWork(db, dir);
  return { db, dir };
}

describe('Full Backup export', () => {
  it('never includes tokens or jobs', () => {
    const { db, dir } = source();
    const text = JSON.stringify(exportFullBackup(db, { includeLibrary: true, dataDir: dir }));
    expect(text).not.toContain(ACCESS);
    expect(text).not.toContain(REFRESH);
    expect(text).not.toContain('"jobs"');
    expect(text).not.toContain('"auth"');
  });

  it('leaves the library out unless asked', () => {
    const { db, dir } = source();
    const backup = exportFullBackup(db, { includeLibrary: false, dataDir: dir });
    expect(backup.library).toBeNull();
    expect(backup.includesLibrary).toBe(false);
    expect(backup.work.djSets).toHaveLength(2);
  });
});

describe('Full Backup import', () => {
  it('round-trips work and library into an empty device', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: true, dataDir: a.dir }));

    const b = { db: openDb(':memory:'), dir: tempDir() };
    const preview = previewImport(b.db, backup, { dataDir: b.dir });
    expect(preview.conflicts).toEqual([]);
    expect(preview.summary.djSets).toEqual({ new: 2, conflicts: 0, unchanged: 0 });
    expect(preview.library?.backup.tracks).toBe(2);

    const result = applyImport(b.db, backup, { importLibrary: true, dataDir: b.dir });
    expect(result.library).toEqual({ replaced: true, rows: 12 });
    expect(readWork(b.db, b.dir)).toEqual(readWork(a.db, a.dir));
    expect(libraryRows(b.db)).toEqual(libraryRows(a.db));
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM auth').get()).toEqual({ n: 0 });
    expect(readdirSync(join(b.dir, 'backups'))).toHaveLength(1);
    expect(readdirSync(join(b.dir, 'full-backups'))[0]).toMatch(/^auto-before-import-.*\.json$/);

    // A second import of the same file changes nothing.
    const again = previewImport(b.db, backup, { dataDir: b.dir });
    expect(Object.values(again.summary).every((s) => s.new === 0 && s.conflicts === 0)).toBe(true);
  });

  it("restores the DJ page's current set only on a device without one", () => {
    const a = source();
    const put = (db: DB, seed: number) =>
      db
        .prepare(
          "INSERT INTO dj_workspace (id, config_json, seed, result_json, from_draft_json, updated_at) VALUES (1, '{}', ?, '{\"tracks\":[]}', NULL, '2026-10-14T10:00:00Z')",
        )
        .run(seed);
    put(a.db, 11);
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: false, dataDir: a.dir }));
    expect(backup.work.djWorkspace?.seed).toBe(11);

    const empty = { db: openDb(':memory:'), dir: tempDir() };
    expect(applyImport(empty.db, backup, { dataDir: empty.dir }).djWorkspace).toBe('restored');
    expect(empty.db.prepare('SELECT seed FROM dj_workspace').get()).toEqual({ seed: 11 });

    const busy = { db: openDb(':memory:'), dir: tempDir() };
    put(busy.db, 22);
    expect(applyImport(busy.db, backup, { dataDir: busy.dir }).djWorkspace).toBe('kept-current');
    expect(busy.db.prepare('SELECT seed FROM dj_workspace').get()).toEqual({ seed: 22 });
  });

  it('remaps Backup ids for the prune log and restores', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: false, dataDir: a.dir }));
    const b = { db: openDb(':memory:'), dir: tempDir() };
    b.db.prepare("INSERT INTO backups (id, playlist_id, name, created_at, json) VALUES (1, 'other', 'Other', '2026-08-01', '{}')").run();
    applyImport(b.db, backup, { dataDir: b.dir });
    const imported = b.db.prepare("SELECT id FROM backups WHERE playlist_id = 'old1'").get() as { id: number };
    expect(imported.id).not.toBe(1);
    expect(b.db.prepare('SELECT backup_id FROM prune_log').get()).toEqual({ backup_id: imported.id });
    expect(b.db.prepare('SELECT backup_id FROM backup_restores').get()).toEqual({ backup_id: imported.id });
  });

  describe('conflicts', () => {
    function conflicted() {
      const a = source();
      const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: false, dataDir: a.dir }));
      const b = { db: openDb(':memory:'), dir: tempDir() };
      b.db.prepare("INSERT INTO dj_templates VALUES ('mine-tpl', 'FRIDAY WARM-UP', 1, '{}', '2026-01-01', '2026-01-01')").run();
      b.db.prepare(
        "INSERT INTO dj_sets (id, name, config_json, result_json, created_at, status) VALUES ('set1', 'My version', '{}', '{\"tracks\":[]}', '2026-10-03', 'draft')",
      ).run();
      b.db.prepare("INSERT INTO proposal_state VALUES ('p-0', 'dropped', NULL, NULL, '2026-10-06')").run();
      b.db.prepare("INSERT INTO backups (id, playlist_id, name, created_at, json) VALUES (7, 'old1', 'Old One', '2026-09-01T00:00:00Z', '{}')").run();
      writeFileSync(join(b.dir, 'proposals.json'), proposalsFile(5));
      return { backup, b };
    }

    it('lists each conflict with both sides', () => {
      const { backup, b } = conflicted();
      const preview = previewImport(b.db, backup, { dataDir: b.dir });
      expect(preview.conflicts.map((c) => conflictChoiceKey(c)).sort()).toEqual(
        ['backups:old1@2026-09-01T00:00:00Z', 'djSets:set1', 'djTemplates:friday warm-up', 'proposalState:p-0', 'proposalsFile:proposals.json'].sort(),
      );
      const set = preview.conflicts.find((c) => c.kind === 'djSets')!;
      expect(set).toMatchObject({ label: 'My version / Draft set', mine: expect.stringContaining('0 tracks'), theirs: expect.stringContaining('1 tracks') });
      expect(preview.conflicts.find((c) => c.kind === 'proposalState')).toMatchObject({ label: 'Fake 0', canKeepBoth: false });
      expect(preview.summary.djSets).toEqual({ new: 1, conflicts: 1, unchanged: 0 });
    });

    it('keeps mine', () => {
      const { backup, b } = conflicted();
      const before = readWork(b.db, b.dir);
      const result = applyImport(b.db, backup, { defaultChoice: 'mine', dataDir: b.dir });
      const after = readWork(b.db, b.dir);
      expect(after.djTemplates).toEqual(before.djTemplates);
      expect(after.djSets.find((s) => s.id === 'set1')?.name).toBe('My version');
      expect(after.proposalState).toEqual(before.proposalState);
      expect(after.proposalsFile).toBe(before.proposalsFile);
      expect(result.counts.djSets).toMatchObject({ added: 1, skipped: 1 });
    });

    it('uses the backup', () => {
      const { backup, b } = conflicted();
      const result = applyImport(b.db, backup, { defaultChoice: 'theirs', dataDir: b.dir });
      const after = readWork(b.db, b.dir);
      expect(after.djTemplates).toEqual([expect.objectContaining({ id: 'mine-tpl', name: 'Friday warm-up', include_pool: 0 })]);
      expect(after.djSets.find((s) => s.id === 'set1')?.name).toBe('Draft set');
      expect(after.proposalState[0]?.status).toBe('approved');
      expect(after.proposalsFile).toBe(proposalsFile(2));
      expect(after.backups).toEqual([expect.objectContaining({ id: 7, json: backup.work.backups[0]!.json })]);
      expect(result.counts.proposalsFile).toMatchObject({ replaced: 1 });
    });

    it('keeps both where a copy makes sense', () => {
      const { backup, b } = conflicted();
      applyImport(b.db, backup, { defaultChoice: 'both', dataDir: b.dir });
      const after = readWork(b.db, b.dir);
      expect(after.djTemplates.map((t) => t.name).sort()).toEqual(['FRIDAY WARM-UP', 'Friday warm-up (imported)']);
      expect(after.djSets.filter((s) => s.name.startsWith('Draft set'))).toEqual([
        expect.objectContaining({ name: 'Draft set (imported)', status: 'draft' }),
      ]);
      expect(after.proposalState[0]?.status).toBe('dropped');
      expect(after.proposalsFile).toBe(proposalsFile(5));
      expect(after.backups).toHaveLength(2);
    });

    it('follows per-conflict choices over the default', () => {
      const { backup, b } = conflicted();
      applyImport(b.db, backup, { defaultChoice: 'mine', choices: { 'djSets:set1': 'theirs' }, dataDir: b.dir });
      const after = readWork(b.db, b.dir);
      expect(after.djSets.find((s) => s.id === 'set1')?.name).toBe('Draft set');
      expect(after.djTemplates[0]?.name).toBe('FRIDAY WARM-UP');
    });
  });

  it('replaces the library all-or-nothing', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: true, dataDir: a.dir }));
    backup.library!.tracks!.rows.push([...backup.library!.tracks!.rows[0]!]); // duplicate primary key

    const b = { db: openDb(':memory:'), dir: tempDir() };
    b.db.prepare("INSERT INTO tracks (id, uri, name, duration_ms) VALUES ('mine', 'spotify:track:mine', 'Get Lucky', 248000)").run();
    expect(() => applyImport(b.db, backup, { importLibrary: true, dataDir: b.dir })).toThrow();
    expect(b.db.prepare('SELECT id FROM tracks').all()).toEqual([{ id: 'mine' }]);
    expect(readWork(b.db, b.dir).djSets).toEqual([]);
    expect(existsSync(join(b.dir, 'proposals.json'))).toBe(false);
  });

  it('rejects unknown library columns', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: true, dataDir: a.dir }));
    backup.library!.tags!.columns[0] = 'evil"; DROP TABLE tracks; --';
    const b = { db: openDb(':memory:'), dir: tempDir() };
    expect(() => applyImport(b.db, backup, { importLibrary: true, dataDir: b.dir })).toThrow(FullBackupError);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 0 });
  });

  it('skips the library unless asked', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: true, dataDir: a.dir }));
    const b = { db: openDb(':memory:'), dir: tempDir() };
    expect(applyImport(b.db, backup, { dataDir: b.dir }).library).toEqual({ replaced: false, rows: 0 });
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 0 });
  });

  it('refuses while a job runs', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: false, dataDir: a.dir }));
    const b = { db: openDb(':memory:'), dir: tempDir() };
    b.db.prepare("INSERT INTO jobs (id, kind, status, started_at) VALUES ('j', 'enrich', 'running', '2026-10-01')").run();
    expect(() => applyImport(b.db, backup, { dataDir: b.dir })).toThrow(/enrich job is running/);
  });

  it('writes the automatic Full Backup of the old state first', () => {
    const a = source();
    const backup = roundTrip(exportFullBackup(a.db, { includeLibrary: false, dataDir: a.dir }));
    const b = source();
    const { autoBackup } = applyImport(b.db, backup, { dataDir: b.dir, now: new Date('2026-10-14T12:00:00Z') });
    expect(autoBackup).toContain('auto-before-import-2026-10-14T12-00-00-000Z.json');
    const saved = parseFullBackup(JSON.parse(readFileSync(autoBackup, 'utf8')));
    expect(saved.ok && saved.backup.includesLibrary).toBe(true);
  });
});

describe('parseFullBackup', () => {
  it('rejects other files with a clear message', () => {
    expect(parseFullBackup({ version: 1, proposals: [] })).toEqual({ ok: false, error: 'This file is not a Spotify Curator Full Backup.' });
    expect(parseFullBackup(null)).toMatchObject({ ok: false });
    expect(parseFullBackup({ format: 'spotify-curator-backup', version: 2 })).toMatchObject({ ok: false, error: expect.stringContaining('newer version') });
    expect(parseFullBackup({ format: 'spotify-curator-backup', version: 1, exportedAt: 'x', includesLibrary: false, work: { djSets: [{ id: 1 }] } })).toMatchObject({
      ok: false,
      error: expect.stringContaining('damaged at work.djSets.0'),
    });
  });
});
