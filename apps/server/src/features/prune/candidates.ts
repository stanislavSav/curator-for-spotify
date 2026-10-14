import { DEFAULT_PRUNE_MONTHS, MIN_PLAY_MS, type PruneCandidatesResponse } from '@curator/shared';
import type { DB } from '../../db/db.ts';
import { cutoffDate, scorePlaylists, type EvidenceInput, type EvidencePlaylist } from './evidence.ts';
import { historySummary } from './history.ts';

const PLAYLIST_CONTEXT = 'spotify:playlist:';

export function loadEvidenceInput(db: DB, cutoff: Date): EvidenceInput {
  const playlists = (
    db
      .prepare(
        `SELECT id, name, kind, owner_id, owner_name, items_readable, items_total, collaborative, image_url
         FROM playlists WHERE removed_at IS NULL`,
      )
      .all() as {
      id: string;
      name: string;
      kind: EvidencePlaylist['kind'];
      owner_id: string;
      owner_name: string;
      items_readable: number;
      items_total: number;
      collaborative: number;
      image_url: string | null;
    }[]
  ).map(
    (r): EvidencePlaylist => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      itemsReadable: r.items_readable === 1,
      itemsTotal: r.items_total,
      collaborative: r.collaborative === 1,
      imageUrl: r.image_url,
    }),
  );

  const items = (
    db
      .prepare(
        `SELECT pi.playlist_id, pi.track_id, pi.added_at, pi.added_by FROM playlist_items pi
         JOIN playlists p ON p.id = pi.playlist_id AND p.removed_at IS NULL`,
      )
      .all() as { playlist_id: string; track_id: string; added_at: string | null; added_by: string | null }[]
  ).map((r) => ({ playlistId: r.playlist_id, trackId: r.track_id, addedAt: r.added_at, addedBy: r.added_by }));

  const likedTrackIds = new Set(
    (db.prepare('SELECT track_id FROM liked_tracks').all() as { track_id: string }[]).map((r) => r.track_id),
  );

  const contextPlays = (
    db
      .prepare(`SELECT played_at, context_uri FROM recent_plays WHERE context_uri LIKE '${PLAYLIST_CONTEXT}%'`)
      .all() as { played_at: string; context_uri: string }[]
  ).map((r) => ({ playlistId: r.context_uri.slice(PLAYLIST_CONTEXT.length), playedAt: r.played_at }));

  // Track id = the part after "spotify:track:" (character 15 on).
  const cutoffIso = cutoff.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const trackPlays = new Map(
    (
      db
        .prepare(
          `SELECT substr(track_uri, 15) AS track_id, MAX(ts) AS last_played, SUM(ts >= ?) AS plays_in_window
           FROM stream_history WHERE ms_played >= ? GROUP BY track_uri`,
        )
        .all(cutoffIso, MIN_PLAY_MS) as { track_id: string; last_played: string; plays_in_window: number }[]
    ).map((r) => [r.track_id, { lastPlayed: r.last_played, playsInWindow: r.plays_in_window }]),
  );

  const { since } = db.prepare('SELECT MIN(played_at) AS since FROM recent_plays').get() as { since: string | null };
  const auth = db.prepare('SELECT user_id FROM auth WHERE id = 1').get() as { user_id: string | null } | undefined;

  return {
    playlists,
    items,
    likedTrackIds,
    contextPlays,
    trackPlays,
    history: historySummary(db),
    recentPlaysSince: since,
    userId: auth?.user_id ?? null,
  };
}

export function parseMonths(raw: string | undefined): number {
  const n = Number(raw ?? DEFAULT_PRUNE_MONTHS);
  if (!Number.isFinite(n)) return DEFAULT_PRUNE_MONTHS;
  return Math.min(120, Math.max(1, Math.round(n)));
}

export function getCandidates(db: DB, months: number, now = new Date()): PruneCandidatesResponse {
  return scorePlaylists(loadEvidenceInput(db, cutoffDate(now, months)), { months, now });
}
