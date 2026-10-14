import type { TimeRange } from '@curator/shared';
import type { DB } from '../../db/db.ts';
import type { MappedTrack, PlaylistItemRow, PlaylistRow, RecentPlayRow } from './mapping.ts';

// DB writes for the sync job. Each function is one transaction.

/**
 * Upserts the listed playlists, clears removed_at for them, and sets
 * removed_at for every playlist that was not listed in this sync.
 */
export function savePlaylists(db: DB, rows: PlaylistRow[], syncedAt: string) {
  const upsert = db.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, owner_name, kind, items_readable, items_total, snapshot_id,
       image_url, public, collaborative, library_position, synced_at, removed_at)
     VALUES (@id, @name, @description, @owner_id, @owner_name, @kind, @items_readable, @items_total, @snapshot_id,
       @image_url, @public, @collaborative, @library_position, @synced_at, NULL)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description,
       owner_id = excluded.owner_id, owner_name = excluded.owner_name, kind = excluded.kind,
       -- A 403 on the items keeps the playlist unreadable until its snapshot changes.
       items_readable = CASE WHEN playlists.items_readable = 0 AND playlists.items_snapshot_id = excluded.snapshot_id
         THEN 0 ELSE excluded.items_readable END,
       items_total = excluded.items_total, snapshot_id = excluded.snapshot_id, image_url = excluded.image_url,
       public = excluded.public, collaborative = excluded.collaborative,
       library_position = excluded.library_position, synced_at = excluded.synced_at, removed_at = NULL`,
  );
  db.transaction(() => {
    for (const row of rows) upsert.run({ ...row, synced_at: syncedAt });
    db.prepare('UPDATE playlists SET removed_at = ? WHERE removed_at IS NULL AND synced_at != ?').run(syncedAt, syncedAt);
  })();
}

/** Readable, not removed playlists whose items changed since the last item sync. */
export function playlistsNeedingItems(db: DB): { id: string; name: string; snapshot_id: string }[] {
  return db
    .prepare(
      `SELECT id, name, snapshot_id FROM playlists
       WHERE removed_at IS NULL AND items_readable = 1
         AND (items_snapshot_id IS NULL OR items_snapshot_id != snapshot_id)
       ORDER BY library_position`,
    )
    .all() as { id: string; name: string; snapshot_id: string }[];
}

/** Upserts tracks and their artists. Never touches artists.genres_json (enrich owns it). */
export function saveTracks(db: DB, tracks: Iterable<MappedTrack>) {
  const upsertTrack = db.prepare(
    `INSERT INTO tracks (id, uri, name, duration_ms, isrc, album_id, album_name, release_date)
     VALUES (@id, @uri, @name, @duration_ms, @isrc, @album_id, @album_name, @release_date)
     ON CONFLICT(id) DO UPDATE SET uri = excluded.uri, name = excluded.name, duration_ms = excluded.duration_ms,
       isrc = COALESCE(excluded.isrc, tracks.isrc), album_id = COALESCE(excluded.album_id, tracks.album_id),
       album_name = excluded.album_name, release_date = COALESCE(excluded.release_date, tracks.release_date)`,
  );
  const upsertArtist = db.prepare(
    'INSERT INTO artists (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name',
  );
  const clearTrackArtists = db.prepare('DELETE FROM track_artists WHERE track_id = ?');
  const insertTrackArtist = db.prepare(
    'INSERT OR IGNORE INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)',
  );
  const seen = new Set<string>();
  db.transaction(() => {
    for (const { track, artists } of tracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      upsertTrack.run(track);
      clearTrackArtists.run(track.id);
      artists.forEach((a, i) => {
        upsertArtist.run(a.id, a.name);
        insertTrackArtist.run(track.id, a.id, i);
      });
    }
  })();
}

export function saveArtists(db: DB, artists: { id: string; name: string }[]) {
  const upsert = db.prepare('INSERT INTO artists (id, name) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name');
  db.transaction(() => {
    for (const a of artists) upsert.run(a.id, a.name);
  })();
}

export function replacePlaylistItems(
  db: DB,
  playlistId: string,
  snapshotId: string,
  entries: { item: PlaylistItemRow; track: MappedTrack }[],
) {
  const insert = db.prepare(
    'INSERT INTO playlist_items (playlist_id, position, track_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction(() => {
    saveTracks(
      db,
      entries.map((e) => e.track),
    );
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
    for (const { item } of entries) insert.run(playlistId, item.position, item.track_id, item.added_at, item.added_by);
    db.prepare('UPDATE playlists SET items_snapshot_id = ? WHERE id = ?').run(snapshotId, playlistId);
  })();
}

/** The API refused the items (403). Store that, and drop items we can no longer confirm. */
export function markItemsUnreadable(db: DB, playlistId: string, snapshotId: string) {
  db.transaction(() => {
    db.prepare('DELETE FROM playlist_items WHERE playlist_id = ?').run(playlistId);
    db.prepare('UPDATE playlists SET items_readable = 0, items_snapshot_id = ? WHERE id = ?').run(snapshotId, playlistId);
  })();
}

export function replaceLikedTracks(db: DB, entries: { addedAt: string; track: MappedTrack }[]) {
  const insert = db.prepare('INSERT OR IGNORE INTO liked_tracks (track_id, added_at) VALUES (?, ?)');
  db.transaction(() => {
    saveTracks(
      db,
      entries.map((e) => e.track),
    );
    db.prepare('DELETE FROM liked_tracks').run();
    for (const e of entries) insert.run(e.track.track.id, e.addedAt);
  })();
}

/** Ranks are 1-based. */
export function replaceTopTracks(db: DB, range: TimeRange, tracks: MappedTrack[]) {
  const insert = db.prepare('INSERT INTO top_tracks (time_range, rank, track_id) VALUES (?, ?, ?)');
  db.transaction(() => {
    saveTracks(db, tracks);
    db.prepare('DELETE FROM top_tracks WHERE time_range = ?').run(range);
    tracks.forEach((t, i) => insert.run(range, i + 1, t.track.id));
  })();
}

/** Ranks are 1-based. */
export function replaceTopArtists(db: DB, range: TimeRange, artists: { id: string; name: string }[]) {
  const insert = db.prepare('INSERT INTO top_artists (time_range, rank, artist_id) VALUES (?, ?, ?)');
  db.transaction(() => {
    saveArtists(db, artists);
    db.prepare('DELETE FROM top_artists WHERE time_range = ?').run(range);
    artists.forEach((a, i) => insert.run(range, i + 1, a.id));
  })();
}

/** Insert-or-ignore, so plays add up across syncs. Returns how many were new. */
export function addRecentPlays(db: DB, entries: { play: RecentPlayRow; track: MappedTrack }[]): number {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO recent_plays (played_at, track_id, context_type, context_uri)
     VALUES (@played_at, @track_id, @context_type, @context_uri)`,
  );
  let added = 0;
  db.transaction(() => {
    saveTracks(
      db,
      entries.map((e) => e.track),
    );
    for (const { play } of entries) added += insert.run(play).changes;
  })();
  return added;
}
