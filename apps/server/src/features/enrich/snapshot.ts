import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  camelotLabel,
  SNAPSHOT_VERSION,
  toCamelot,
  type LibraryTrack,
  type Snapshot,
  type SnapshotPlaylist,
  type SnapshotTrack,
  type TimeRange,
} from '@curator/shared';
import { DATA_DIR, type DB } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { round2 } from './store.ts';

export const SNAPSHOT_FILE = resolve(DATA_DIR, 'snapshot.json');
export const SNAPSHOT_MAX_TAGS = 6;
export const SNAPSHOT_TAG_COUNTS = 150;
const MIN_PLAY_MS = 30_000;

export interface HistoryStats {
  plays12m: number;
  /** Last play ≥30 s at any time, ISO timestamp. */
  lastPlayed: string;
}

/** Streaming History per track URI: plays ≥30 s in the 12 months before `now`. */
export function historyByUri(db: DB, now: Date): Map<string, HistoryStats> {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const rows = db
    .prepare(
      `SELECT track_uri, SUM(ts >= ? AND ts <= ?) AS plays, MAX(ts) AS last
       FROM stream_history WHERE ms_played >= ? GROUP BY track_uri`,
    )
    .all(cutoff.toISOString(), now.toISOString(), MIN_PLAY_MS) as { track_uri: string; plays: number; last: string }[];
  return new Map(rows.map((r) => [r.track_uri, { plays12m: r.plays, lastPlayed: r.last }]));
}

const RANGE_KEYS: Record<TimeRange, 's' | 'm' | 'l'> = { short_term: 's', medium_term: 'm', long_term: 'l' };
const day = (iso: string) => iso.slice(0, 10);

export function toSnapshotTrack(t: LibraryTrack, history: HistoryStats | undefined): SnapshotTrack {
  const year = Number(t.releaseDate?.slice(0, 4));
  const out: SnapshotTrack = {
    id: t.id,
    name: t.name,
    artists: t.artists.map((a) => a.name),
    ...(year > 0 ? { year } : {}),
    dur: Math.round(t.durationMs / 1000),
  };
  if (t.likedAt) out.liked = day(t.likedAt);
  if (t.playlistIds.length) out.pl = t.playlistIds;
  const top: NonNullable<SnapshotTrack['top']> = {};
  for (const [range, rank] of Object.entries(t.topRanks) as [TimeRange, number][]) top[RANGE_KEYS[range]] = rank;
  if (Object.keys(top).length) out.top = top;
  if (history?.plays12m) out.plays12m = history.plays12m;
  if (history?.lastPlayed) out.lastPlayed = day(history.lastPlayed);
  const f = t.features;
  if (f) {
    if (f.tempo != null) out.bpm = round2(f.tempo);
    const cam = toCamelot(f.key, f.mode);
    if (cam) out.cam = camelotLabel(cam);
    if (f.energy != null) out.energy = round2(f.energy);
    if (f.valence != null) out.valence = round2(f.valence);
    if (f.danceability != null) out.dance = round2(f.danceability);
    if (f.acousticness != null) out.acoustic = round2(f.acousticness);
    if (f.instrumentalness != null) out.instr = round2(f.instrumentalness);
  }
  if (t.tags.length) out.tags = t.tags.slice(0, SNAPSHOT_MAX_TAGS);
  return out;
}

const hasFeatures = (t: SnapshotTrack) =>
  t.bpm != null || t.cam != null || t.energy != null || t.valence != null || t.dance != null;

/** Builds the Snapshot from the DB. Pure apart from reading the DB. */
export function buildSnapshot(db: DB, now = new Date()): Snapshot {
  const history = historyByUri(db, now);
  const library = getLibraryTracks(db);
  const tracks = library
    .map((t) => toSnapshotTrack(t, history.get(t.uri)))
    // Liked newest first, then the rest by artist and title: a stable order an Agent can page through.
    .sort(
      (a, b) =>
        (b.liked ?? '').localeCompare(a.liked ?? '') ||
        (a.artists[0] ?? '').localeCompare(b.artists[0] ?? '') ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );

  const tagCounts = new Map<string, number>();
  for (const t of tracks) for (const tag of t.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);

  const playlists = (
    db
      .prepare(
        `SELECT id, name, kind, items_total, description FROM playlists WHERE removed_at IS NULL
         ORDER BY library_position IS NULL, library_position, name`,
      )
      .all() as { id: string; name: string; kind: SnapshotPlaylist['kind']; items_total: number; description: string }[]
  ).map((p) => {
    const out: SnapshotPlaylist = { id: p.id, name: p.name, kind: p.kind, n: p.items_total };
    const desc = p.description.trim();
    if (desc) out.desc = desc.length > 200 ? `${desc.slice(0, 199)}…` : desc;
    return out;
  });

  const topArtistRows = db
    .prepare(
      `SELECT ta.time_range, a.name FROM top_artists ta JOIN artists a ON a.id = ta.artist_id ORDER BY ta.time_range, ta.rank`,
    )
    .all() as { time_range: TimeRange; name: string }[];
  const topArtists: Snapshot['topArtists'] = { s: [], m: [], l: [] };
  for (const r of topArtistRows) topArtists[RANGE_KEYS[r.time_range]]?.push(r.name);

  const auth = db.prepare('SELECT user_id, display_name FROM auth WHERE id = 1').get() as
    | { user_id: string | null; display_name: string | null }
    | undefined;

  return {
    version: SNAPSHOT_VERSION,
    generatedAt: now.toISOString(),
    user: auth?.display_name ?? auth?.user_id ?? '',
    coverage: {
      tracks: tracks.length,
      withFeatures: tracks.filter(hasFeatures).length,
      withTags: tracks.filter((t) => t.tags?.length).length,
      withHistory: tracks.filter((t) => t.lastPlayed).length,
    },
    playlists,
    topArtists,
    tagCounts: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, SNAPSHOT_TAG_COUNTS),
    tracks,
  };
}

/**
 * Pretty top level, one compact line per playlist and per track, so an Agent can
 * read the file in line ranges. Still valid JSON.
 */
export function serializeSnapshot(s: Snapshot): string {
  const lines = (items: unknown[]) =>
    items.length ? `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]` : '[]';
  const parts = [
    `  "version": ${JSON.stringify(s.version)}`,
    `  "generatedAt": ${JSON.stringify(s.generatedAt)}`,
    `  "user": ${JSON.stringify(s.user)}`,
    `  "coverage": ${JSON.stringify(s.coverage)}`,
    `  "playlists": ${lines(s.playlists)}`,
    `  "topArtists": {\n${(['s', 'm', 'l'] as const).map((k) => `    "${k}": ${JSON.stringify(s.topArtists[k])}`).join(',\n')}\n  }`,
    `  "tagCounts": ${JSON.stringify(s.tagCounts)}`,
    `  "tracks": ${lines(s.tracks)}`,
  ];
  return `{\n${parts.join(',\n')}\n}\n`;
}

/** Writes data/snapshot.json atomically and returns its size in bytes. */
export function writeSnapshot(s: Snapshot, file = SNAPSHOT_FILE): number {
  const text = serializeSnapshot(s);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, text);
  renameSync(`${file}.tmp`, file);
  return Buffer.byteLength(text);
}

export function snapshotSummary(s: Snapshot, bytes: number): string {
  const pct = (n: number) => (s.coverage.tracks ? Math.round((n / s.coverage.tracks) * 100) : 0);
  return (
    `Snapshot: ${s.coverage.tracks} tracks, ${s.playlists.length} playlists, ` +
    `${pct(s.coverage.withFeatures)}% with features, ${pct(s.coverage.withTags)}% with tags, ` +
    `${pct(s.coverage.withHistory)}% with history. ${(bytes / 1024).toFixed(0)} KB.`
  );
}
