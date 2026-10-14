import type { TimeRange } from '@curator/shared';
import { nowIso, type DB } from '../../db/db.ts';
import { SpotifyApiError, type Page, type SpotifyClient } from '../../spotify/client.ts';
import {
  mapPlaylist,
  mapPlaylistEntry,
  mapRecentPlay,
  mapTrack,
  PLAYLIST_ITEM_FIELDS,
  type MappedTrack,
  type RawArtist,
  type RawPlayHistory,
  type RawPlaylist,
  type RawPlaylistEntry,
  type RawSavedTrack,
  type RawTrack,
} from './mapping.ts';
import {
  addRecentPlays,
  markItemsUnreadable,
  playlistsNeedingItems,
  replaceLikedTracks,
  replacePlaylistItems,
  replaceTopArtists,
  replaceTopTracks,
  savePlaylists,
} from './store.ts';

export const TIME_RANGES: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

export interface SyncResult {
  playlists: number;
  removed: number;
  itemsUpdated: number;
  itemsSkipped: number;
  unreadable: number;
  liked: number;
  newRecentPlays: number;
}

type Progress = (done: number, total: number, message: string) => void;

const isMapped = <T>(x: T | null): x is T => x !== null;

/**
 * Pulls the Library from Spotify into SQLite. Incremental: playlists whose
 * snapshot_id did not change since the last item sync are not re-read.
 */
export async function runSync(db: DB, client: SpotifyClient, progress: Progress = () => {}): Promise<SyncResult> {
  // me + playlist list + liked + 3 top tracks + 3 top artists + recent plays
  const fixedSteps = 10;
  let total = fixedSteps;
  let done = 0;
  const step = (message: string) => progress(done, total, message);

  step('Reading your profile…');
  const me = await client.get<{ id: string }>('/me');
  done++;

  step('Reading your playlists…');
  const rawPlaylists: RawPlaylist[] = [];
  for await (const p of client.paginate<RawPlaylist | null>('/me/playlists')) {
    if (p) rawPlaylists.push(p);
    if (rawPlaylists.length % 50 === 0) step(`Reading your playlists… ${rawPlaylists.length}`);
  }
  const syncedAt = nowIso();
  savePlaylists(
    db,
    rawPlaylists.map((p, i) => mapPlaylist(p, me.id, i)),
    syncedAt,
  );
  const removed = (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE removed_at = ?').get(syncedAt) as { n: number }).n;
  done++;

  const changed = playlistsNeedingItems(db);
  total += changed.length;
  const readable = (db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE removed_at IS NULL AND items_readable = 1').get() as { n: number }).n;
  let unreadable = 0;
  for (const [i, pl] of changed.entries()) {
    step(`Playlist ${i + 1} of ${changed.length}: ${pl.name}`);
    try {
      const entries: ReturnType<typeof mapPlaylistEntry>[] = [];
      let index = 0;
      for await (const e of client.paginate<RawPlaylistEntry>(`/playlists/${pl.id}/items`, { fields: PLAYLIST_ITEM_FIELDS })) {
        entries.push(mapPlaylistEntry(e, index++));
      }
      replacePlaylistItems(db, pl.id, pl.snapshot_id, entries.filter(isMapped));
    } catch (err) {
      if (!(err instanceof SpotifyApiError) || err.status !== 403) throw err;
      markItemsUnreadable(db, pl.id, pl.snapshot_id);
      unreadable++;
    }
    done++;
  }

  step('Reading Liked Songs…');
  const liked: { addedAt: string; track: MappedTrack }[] = [];
  let likedSeen = 0;
  for await (const s of client.paginate<RawSavedTrack>('/me/tracks')) {
    const track = mapTrack(s.track);
    if (track) liked.push({ addedAt: s.added_at, track });
    if (++likedSeen % 50 === 0) step(`Reading Liked Songs… ${likedSeen}`);
  }
  replaceLikedTracks(db, liked);
  done++;

  for (const range of TIME_RANGES) {
    step(`Reading top tracks (${range.replace('_', ' ')})…`);
    const page = await client.get<Page<RawTrack>>('/me/top/tracks', { time_range: range, limit: 50 });
    replaceTopTracks(db, range, page.items.map(mapTrack).filter(isMapped));
    done++;

    step(`Reading top artists (${range.replace('_', ' ')})…`);
    const artists = await client.get<Page<RawArtist>>('/me/top/artists', { time_range: range, limit: 50 });
    replaceTopArtists(
      db,
      range,
      artists.items.filter((a): a is { id: string; name: string } => Boolean(a.id)),
    );
    done++;
  }

  step('Reading recently played…');
  const recent = await client.get<{ items: RawPlayHistory[] }>('/me/player/recently-played', { limit: 50 });
  const newRecentPlays = addRecentPlays(db, recent.items.map(mapRecentPlay).filter(isMapped));
  done++;
  progress(done, total, 'Saving…');

  return {
    playlists: rawPlaylists.length,
    removed,
    itemsUpdated: changed.length - unreadable,
    itemsSkipped: readable - changed.length,
    unreadable,
    liked: liked.length,
    newRecentPlays,
  };
}

export function describeSync(r: SyncResult): string {
  const parts = [
    `${r.playlists} playlists (${r.itemsUpdated} read, ${r.itemsSkipped} unchanged)`,
    `${r.liked} liked songs`,
    `${r.newRecentPlays} new recent plays`,
  ];
  if (r.removed) parts.push(`${r.removed} no longer in your Library`);
  if (r.unreadable) parts.push(`${r.unreadable} refused by Spotify (403)`);
  return `Synced ${parts.join(', ')}.`;
}
