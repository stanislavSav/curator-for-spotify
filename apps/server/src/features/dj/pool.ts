import {
  toCamelot,
  type DjLibraryFilter,
  type DjPool,
  type DjPoolOptions,
  type DjPoolStats,
  type DjSetConfig,
  type LibraryTrack,
  type TimeRange,
} from '@curator/shared';
import type { DB } from '../../db/db.ts';
import type { DjCandidate } from './order.ts';

const RANGES: TimeRange[] = ['short_term', 'medium_term', 'long_term'];

export const trackYear = (t: Pick<LibraryTrack, 'releaseDate'>) => {
  const y = t.releaseDate ? Number(t.releaseDate.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 0 ? y : null;
};

const tempoOf = (t: LibraryTrack) => (t.features?.tempo != null && t.features.tempo > 0 ? t.features.tempo : null);

export function matchesLibraryFilter(t: LibraryTrack, f: DjLibraryFilter): boolean {
  if (f.likedOnly && !t.likedAt) return false;
  if (f.tags.length) {
    const wanted = new Set(f.tags.map((x) => x.toLowerCase()));
    if (!t.tags.some((x) => wanted.has(x.toLowerCase()))) return false;
  }
  if (f.decades.length) {
    const y = trackYear(t);
    if (y == null || !f.decades.includes(Math.floor(y / 10) * 10)) return false;
  }
  const tempo = tempoOf(t);
  if (f.bpmMin != null && (tempo == null || tempo < f.bpmMin)) return false;
  if (f.bpmMax != null && (tempo == null || tempo > f.bpmMax)) return false;
  const energy = t.features?.energy ?? null;
  if (f.energyMin != null && (energy == null || energy < f.energyMin)) return false;
  if (f.energyMax != null && (energy == null || energy > f.energyMax)) return false;
  return true;
}

/** The Pool: the union of chosen playlists, the filtered Library and recent favourites. */
export function selectPool(tracks: LibraryTrack[], pool: DjPool): LibraryTrack[] {
  const playlists = new Set(pool.playlistIds);
  const ranges = RANGES.filter((r) => pool.recent[r]);
  return tracks.filter(
    (t) =>
      t.playlistIds.some((id) => playlists.has(id)) ||
      (pool.library != null && matchesLibraryFilter(t, pool.library)) ||
      ranges.some((r) => t.topRanks[r] != null),
  );
}

export function inBpmRange(bpm: number, range: DjSetConfig['bpmRange'], allowHalfDouble: boolean): boolean {
  if (!range) return true;
  const ok = (x: number) => x >= range.min && x <= range.max;
  return ok(bpm) || (allowHalfDouble && (ok(bpm * 2) || ok(bpm / 2)));
}

export function toCandidate(t: LibraryTrack): DjCandidate | null {
  const bpm = tempoOf(t);
  if (bpm == null) return null;
  return {
    id: t.id,
    uri: t.uri,
    name: t.name,
    artistIds: t.artists.map((a) => a.id),
    artistNames: t.artists.map((a) => a.name),
    durationMs: t.durationMs,
    bpm,
    camelot: toCamelot(t.features?.key, t.features?.mode),
    energy: t.features?.energy ?? null,
    valence: t.features?.valence ?? null,
    danceability: t.features?.danceability ?? null,
    instrumentalness: t.features?.instrumentalness ?? null,
    acousticness: t.features?.acousticness ?? null,
    tags: t.tags.slice(0, 6),
  };
}

/**
 * Turns the Library into orderable candidates for a config. Tracks without a
 * tempo are dropped and counted. Locked and start tracks join even when they
 * are outside the chosen sources.
 */
export function buildCandidates(
  library: LibraryTrack[],
  cfg: DjSetConfig,
): { candidates: DjCandidate[]; stats: DjPoolStats; warnings: string[] } {
  const excluded = new Set(cfg.excludedTrackIds);
  const pinned = new Set([...cfg.lockedTrackIds, ...(cfg.startTrackId ? [cfg.startTrackId] : [])]);
  const selected = new Map(selectPool(library, cfg.pool).map((t) => [t.id, t]));
  for (const t of library) if (pinned.has(t.id)) selected.set(t.id, t);

  const stats: DjPoolStats = { total: 0, usable: 0, noTempo: 0, outOfBpmRange: 0, noKey: 0, noEnergy: 0 };
  const warnings: string[] = [];
  const candidates: DjCandidate[] = [];
  for (const t of selected.values()) {
    if (excluded.has(t.id) && !pinned.has(t.id)) continue;
    stats.total++;
    const c = toCandidate(t);
    if (!c) {
      stats.noTempo++;
      if (pinned.has(t.id)) warnings.push(`“${t.name}” has no BPM, so it cannot be placed and was left out.`);
      continue;
    }
    if (!pinned.has(t.id) && !inBpmRange(c.bpm, cfg.bpmRange, cfg.allowHalfDouble)) {
      stats.outOfBpmRange++;
      continue;
    }
    if (!c.camelot) stats.noKey++;
    if (c.energy == null) stats.noEnergy++;
    candidates.push(c);
  }
  stats.usable = candidates.length;

  const known = new Set(library.map((t) => t.id));
  const missing = [...pinned].filter((id) => !known.has(id)).length;
  if (missing) warnings.push(`${missing} locked or start track${missing === 1 ? ' is' : 's are'} not in your Library any more.`);
  if (stats.noTempo) warnings.unshift(`${stats.noTempo} Pool track${stats.noTempo === 1 ? ' has' : 's have'} no BPM and ${stats.noTempo === 1 ? 'was' : 'were'} skipped. Run Enrich to fill more.`);
  if (stats.outOfBpmRange) warnings.push(`${stats.outOfBpmRange} Pool track${stats.outOfBpmRange === 1 ? ' is' : 's are'} outside the BPM range.`);
  return { candidates: candidates.sort((a, b) => a.id.localeCompare(b.id)), stats, warnings };
}

/** Data for the DJ Set form: playlists, tags, decades and a BPM histogram. */
export function poolOptions(db: DB, library: LibraryTrack[]): DjPoolOptions {
  const playlists = db
    .prepare(
      `SELECT id, name FROM playlists WHERE removed_at IS NULL AND items_readable = 1 AND kind != 'generated'
       ORDER BY library_position IS NULL, library_position, name`,
    )
    .all() as { id: string; name: string }[];
  const perPlaylist = new Map<string, { tracks: number; withBpm: number }>();
  const tags = new Map<string, number>();
  const decades = new Map<number, number>();
  const bpm = new Map<number, number>();
  const recent: Record<TimeRange, number> = { short_term: 0, medium_term: 0, long_term: 0 };
  const lib = { tracks: library.length, withBpm: 0, withKey: 0, withEnergy: 0, liked: 0 };

  for (const t of library) {
    const tempo = tempoOf(t);
    if (tempo != null) {
      lib.withBpm++;
      const bucket = Math.floor(tempo / 10) * 10;
      bpm.set(bucket, (bpm.get(bucket) ?? 0) + 1);
    }
    if (toCamelot(t.features?.key, t.features?.mode)) lib.withKey++;
    if (t.features?.energy != null) lib.withEnergy++;
    if (t.likedAt) lib.liked++;
    for (const id of t.playlistIds) {
      const p = perPlaylist.get(id) ?? { tracks: 0, withBpm: 0 };
      p.tracks++;
      if (tempo != null) p.withBpm++;
      perPlaylist.set(id, p);
    }
    for (const tag of t.tags.slice(0, 8)) tags.set(tag, (tags.get(tag) ?? 0) + 1);
    const y = trackYear(t);
    if (y != null) decades.set(Math.floor(y / 10) * 10, (decades.get(Math.floor(y / 10) * 10) ?? 0) + 1);
    for (const r of RANGES) if (t.topRanks[r] != null) recent[r]++;
  }

  return {
    playlists: playlists
      .map((p) => ({ id: p.id, name: p.name, ...(perPlaylist.get(p.id) ?? { tracks: 0, withBpm: 0 }) }))
      .filter((p) => p.tracks > 0),
    tags: [...tags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 40)
      .map(([tag, count]) => ({ tag, count })),
    decades: [...decades.entries()].sort((a, b) => a[0] - b[0]).map(([decade, count]) => ({ decade, count })),
    bpmHistogram: [...bpm.entries()].sort((a, b) => a[0] - b[0]).map(([b, count]) => ({ bpm: b, count })),
    recent,
    library: lib,
  };
}
