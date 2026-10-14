import { mkdirSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { BackupInfo, PlaylistBackup, PruneResult, RestoreResult } from '@curator/shared';
import { DATA_DIR, ROOT_DIR, nowIso, type DB } from '../../db/db.ts';
import type { SpotifyClient } from '../../spotify/client.ts';

export const BACKUP_DIR = resolve(DATA_DIR, 'backups');

interface PlaylistRow {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner_name: string;
  kind: 'owned' | 'followed' | 'generated';
  items_readable: number;
  public: number;
  collaborative: number;
  removed_at: string | null;
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'playlist';
}

export function backupFileName(createdAt: string, playlistId: string, name: string): string {
  return `${createdAt.slice(0, 10)}-${playlistId}-${slugify(name)}.json`;
}

interface PlaylistItemObject {
  item?: { uri?: string } | null;
  /** Deprecated alias of item; still sent by some responses. */
  track?: { uri?: string } | null;
}

/** Current item URIs from Spotify, in order. */
export async function fetchItemUris(client: SpotifyClient, playlistId: string): Promise<string[]> {
  const uris: string[] = [];
  for await (const it of client.paginate<PlaylistItemObject>(`/playlists/${playlistId}/items`)) {
    const uri = (it.item ?? it.track)?.uri;
    if (uri) uris.push(uri);
  }
  return uris;
}

function dbItemUris(db: DB, playlistId: string): string[] {
  return (
    db
      .prepare(
        `SELECT t.uri FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id
         WHERE pi.playlist_id = ? ORDER BY pi.position`,
      )
      .all(playlistId) as { uri: string }[]
  ).map((r) => r.uri);
}

export function writeBackup(db: DB, backup: PlaylistBackup, dir = BACKUP_DIR): { id: number; file: string } {
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, backupFileName(backup.createdAt, backup.playlistId, backup.name));
  const json = JSON.stringify(backup, null, 2);
  writeFileSync(path, json);
  const { lastInsertRowid } = db
    .prepare('INSERT INTO backups (playlist_id, name, created_at, json) VALUES (?, ?, ?, ?)')
    .run(backup.playlistId, backup.name, backup.createdAt, json);
  return { id: Number(lastInsertRowid), file: path };
}

export interface PruneOptions {
  backupDir?: string;
  /** Called after each playlist, with the full result list so far. */
  onProgress?: (done: number, total: number, results: PruneResult[]) => void;
}

/**
 * Prunes each playlist: Backup first, then remove from the Library (delete if
 * owned, unfollow if followed). One failure does not stop the others.
 */
export async function runPrune(db: DB, client: SpotifyClient, playlistIds: string[], opts: PruneOptions = {}): Promise<PruneResult[]> {
  const ids = [...new Set(playlistIds)];
  const results: PruneResult[] = ids.map((id) => ({
    playlistId: id,
    name: id,
    kind: null,
    status: 'pending',
    action: null,
    backupId: null,
    backupFile: null,
    tracksFrom: null,
    trackCount: 0,
    error: null,
  }));
  opts.onProgress?.(0, ids.length, results);

  for (const [i, result] of results.entries()) {
    try {
      await pruneOne(db, client, result, opts.backupDir);
      result.status = 'done';
    } catch (err) {
      result.status = 'failed';
      result.error = err instanceof Error ? err.message : String(err);
    }
    opts.onProgress?.(i + 1, ids.length, results);
  }
  return results;
}

async function pruneOne(db: DB, client: SpotifyClient, result: PruneResult, backupDir?: string) {
  const p = db.prepare('SELECT * FROM playlists WHERE id = ?').get(result.playlistId) as PlaylistRow | undefined;
  if (!p) throw new Error('Playlist not found. Run Sync.');
  result.name = p.name;
  if (p.kind === 'generated') throw new Error('Generated Playlists are never pruned.');
  if (p.removed_at) throw new Error('Already removed from the Library.');
  result.kind = p.kind;

  let uris: string[] = [];
  let tracksFrom: PlaylistBackup['tracksFrom'] = 'none';
  if (p.items_readable) {
    try {
      uris = await fetchItemUris(client, p.id);
      tracksFrom = 'spotify';
    } catch {
      uris = dbItemUris(db, p.id);
      tracksFrom = uris.length ? 'database' : 'none';
    }
  } else {
    uris = dbItemUris(db, p.id);
    if (uris.length) tracksFrom = 'database';
  }

  const createdAt = nowIso();
  const backup: PlaylistBackup = {
    version: 1,
    playlistId: p.id,
    uri: `spotify:playlist:${p.id}`,
    name: p.name,
    description: p.description,
    kind: p.kind,
    owner: { id: p.owner_id, name: p.owner_name },
    public: p.public === 1,
    collaborative: p.collaborative === 1,
    createdAt,
    tracksFrom,
    uris,
  };
  const saved = writeBackup(db, backup, backupDir);
  result.backupId = saved.id;
  result.backupFile = relative(ROOT_DIR, saved.file);
  result.tracksFrom = tracksFrom;
  result.trackCount = uris.length;

  await client.removeFromLibrary([backup.uri]);

  const prunedAt = nowIso();
  db.transaction(() => {
    db.prepare('INSERT INTO prune_log (playlist_id, kind, pruned_at, backup_id) VALUES (?, ?, ?, ?)').run(
      p.id,
      p.kind,
      prunedAt,
      saved.id,
    );
    db.prepare('UPDATE playlists SET removed_at = ? WHERE id = ?').run(prunedAt, p.id);
  })();
  result.action = p.kind === 'owned' ? 'deleted' : 'unfollowed';
}

// ---- Backups and Restore --------------------------------------------------------

interface BackupRow {
  id: number;
  playlist_id: string;
  name: string;
  created_at: string;
  json: string;
}

interface RestoreRow {
  backup_id: number;
  restored_at: string;
  action: string;
  playlist_id: string | null;
  url: string | null;
}

export function listBackups(db: DB, dir = BACKUP_DIR): BackupInfo[] {
  const rows = db.prepare('SELECT * FROM backups ORDER BY created_at DESC, id DESC').all() as BackupRow[];
  const restores = new Map(
    (db.prepare('SELECT * FROM backup_restores ORDER BY restored_at').all() as RestoreRow[]).map((r) => [r.backup_id, r]),
  );
  return rows.map((r) => {
    const b = JSON.parse(r.json) as PlaylistBackup;
    const restore = restores.get(r.id);
    return {
      id: r.id,
      playlistId: r.playlist_id,
      name: r.name,
      kind: b.kind,
      ownerName: b.owner.name,
      trackCount: b.uris.length,
      createdAt: r.created_at,
      file: relative(ROOT_DIR, resolve(dir, backupFileName(b.createdAt, b.playlistId, b.name))),
      restored: restore ? { at: restore.restored_at, playlistId: restore.playlist_id, url: restore.url } : null,
    };
  });
}

export class RestoreError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
  }
}

const ADDABLE_URI = /^spotify:(track|episode):/;
const MAX_DESCRIPTION = 300;

export function restoreDescription(original: string, backupDate: string): string {
  const note = `Restored from a Backup of ${backupDate.slice(0, 10)}.`;
  const base = original.trim();
  if (!base) return note;
  const room = MAX_DESCRIPTION - note.length - 1;
  return `${base.length > room ? base.slice(0, room - 1) + '…' : base} ${note}`;
}

/** Followed: follow it again. Owned: recreate it as a new playlist from the Backup URIs. */
export async function restoreBackup(db: DB, client: SpotifyClient, backupId: number): Promise<RestoreResult> {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(backupId) as BackupRow | undefined;
  if (!row) throw new RestoreError('Backup not found.', 404);
  const done = db.prepare('SELECT * FROM backup_restores WHERE backup_id = ?').get(backupId) as RestoreRow | undefined;
  if (done) throw new RestoreError(`This Backup was already restored on ${done.restored_at.slice(0, 10)}.`, 409);
  const b = JSON.parse(row.json) as PlaylistBackup;

  let result: RestoreResult;
  if (b.kind === 'followed') {
    await client.addToLibrary([b.uri]);
    db.prepare('UPDATE playlists SET removed_at = NULL WHERE id = ?').run(b.playlistId);
    result = {
      backupId,
      action: 'refollowed',
      playlistId: b.playlistId,
      url: `https://open.spotify.com/playlist/${b.playlistId}`,
      added: 0,
      skipped: 0,
    };
  } else {
    const uris = b.uris.filter((u) => ADDABLE_URI.test(u));
    const created = await client.createPlaylist({
      name: b.name,
      description: restoreDescription(b.description, b.createdAt),
      uris,
      public: b.public,
    });
    result = {
      backupId,
      action: 'recreated',
      playlistId: created.id,
      url: created.url,
      added: uris.length,
      skipped: b.uris.length - uris.length,
    };
  }
  db.prepare('INSERT INTO backup_restores (backup_id, restored_at, action, playlist_id, url) VALUES (?, ?, ?, ?, ?)').run(
    backupId,
    nowIso(),
    result.action,
    result.playlistId,
    result.url,
  );
  return result;
}
