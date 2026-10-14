import type { SyncSummary } from '@curator/shared';
import type { DB } from '../../db/db.ts';
import { libraryTrackIds } from '../../db/library.ts';
import { latestJob } from '../../jobs/jobs.ts';

const count = (db: DB, sql: string): number => (db.prepare(sql).get() as { n: number }).n;

export function syncSummary(db: DB): SyncSummary {
  const byKind = db
    .prepare('SELECT kind, COUNT(*) AS n FROM playlists WHERE removed_at IS NULL GROUP BY kind')
    .all() as { kind: 'owned' | 'followed' | 'generated'; n: number }[];
  const kinds = Object.fromEntries(byKind.map((r) => [r.kind, r.n]));
  const lastSuccess = db
    .prepare("SELECT finished_at FROM jobs WHERE kind = 'sync' AND status = 'done' ORDER BY started_at DESC LIMIT 1")
    .get() as { finished_at: string } | undefined;

  return {
    playlists: {
      owned: kinds.owned ?? 0,
      followed: kinds.followed ?? 0,
      generated: kinds.generated ?? 0,
      removed: count(db, 'SELECT COUNT(*) AS n FROM playlists WHERE removed_at IS NOT NULL'),
      readable: count(db, 'SELECT COUNT(*) AS n FROM playlists WHERE removed_at IS NULL AND items_readable = 1'),
      itemsSynced: count(
        db,
        'SELECT COUNT(*) AS n FROM playlists WHERE removed_at IS NULL AND items_readable = 1 AND items_snapshot_id IS NOT NULL',
      ),
    },
    likedTracks: count(db, 'SELECT COUNT(*) AS n FROM liked_tracks'),
    libraryTracks: libraryTrackIds(db).length,
    artists: count(db, 'SELECT COUNT(*) AS n FROM artists'),
    recentPlays: count(db, 'SELECT COUNT(*) AS n FROM recent_plays'),
    lastSync: latestJob('sync', db),
    lastSuccessAt: lastSuccess?.finished_at ?? null,
  };
}
