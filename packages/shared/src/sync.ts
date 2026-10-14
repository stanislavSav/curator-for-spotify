// Owned by the sync feature. Types for its API.
import type { Job } from './domain.ts';

/** GET /api/sync/summary — what the local copy of the Library holds. */
export interface SyncSummary {
  playlists: {
    /** Playlists still in the Library, by kind. */
    owned: number;
    followed: number;
    generated: number;
    /** No longer in /me/playlists (pruned or removed in Spotify). */
    removed: number;
    /** Not removed and the API returns their items (owned or collaborative). */
    readable: number;
    /** Readable playlists whose items were synced at least once. */
    itemsSynced: number;
  };
  likedTracks: number;
  /** Unique tracks in Liked Songs, readable playlists, top tracks and recent plays. */
  libraryTracks: number;
  artists: number;
  recentPlays: number;
  /** The newest sync job, running or finished. */
  lastSync: Job | null;
  /** finishedAt of the newest successful sync job. */
  lastSuccessAt: string | null;
}
