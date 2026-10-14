import type { DB } from '../../db/db.ts';
import { libraryTrackIds } from '../../db/library.ts';

/** Failed lookups are retried after this many days. */
export const RETRY_AFTER_DAYS = 30;

export type EntityType = 'track' | 'artist' | 'meta';

/** Marker row: Spotify returned empty genres for the probe artists. */
export const GENRES_STRIPPED = { type: 'meta', id: 'spotify-genres-stripped', source: 'spotify-genre' } as const;

export function retryCutoff(now: Date): string {
  return new Date(now.getTime() - RETRY_AFTER_DAYS * 24 * 3600 * 1000).toISOString();
}

export function recordAttempt(db: DB, type: EntityType, id: string, source: string, ok: boolean, now: Date) {
  db.prepare(
    `INSERT INTO enrich_attempts (entity_type, entity_id, source, attempted_at, ok) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (entity_type, entity_id, source) DO UPDATE SET attempted_at = excluded.attempted_at, ok = excluded.ok`,
  ).run(type, id, source, now.toISOString(), ok ? 1 : 0);
}

/** Entity ids with an attempt for `source` newer than the retry cutoff. */
export function recentAttempts(db: DB, type: EntityType, source: string, now: Date): Set<string> {
  const rows = db
    .prepare('SELECT entity_id FROM enrich_attempts WHERE entity_type = ? AND source = ? AND attempted_at > ?')
    .all(type, source, retryCutoff(now)) as { entity_id: string }[];
  return new Set(rows.map((r) => r.entity_id));
}

export function isGenresStripped(db: DB, now: Date): boolean {
  return recentAttempts(db, GENRES_STRIPPED.type, GENRES_STRIPPED.source, now).has(GENRES_STRIPPED.id);
}

/** Replaces all tags of one entity from one source. */
export function replaceTags(
  db: DB,
  type: 'track' | 'artist',
  id: string,
  source: string,
  tags: { tag: string; weight: number }[],
) {
  db.prepare('DELETE FROM tags WHERE entity_type = ? AND entity_id = ? AND source = ?').run(type, id, source);
  const insert = db.prepare(
    `INSERT INTO tags (entity_type, entity_id, source, tag, weight) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO UPDATE SET weight = MAX(weight, excluded.weight)`,
  );
  for (const t of tags) insert.run(type, id, source, t.tag, t.weight);
}

/** Entity ids that already have at least one tag from `source`. */
export function taggedEntities(db: DB, type: 'track' | 'artist', source: string): Set<string> {
  const rows = db.prepare('SELECT DISTINCT entity_id FROM tags WHERE entity_type = ? AND source = ?').all(type, source) as {
    entity_id: string;
  }[];
  return new Set(rows.map((r) => r.entity_id));
}

export interface LibraryArtist {
  id: string;
  name: string;
  /** Library tracks that credit this artist. */
  tracks: number;
  genresJson: string | null;
}

/** Artists credited on Library tracks, most tracks first. */
export function libraryArtists(db: DB): LibraryArtist[] {
  const ids = new Set(libraryTrackIds(db));
  const rows = db
    .prepare(
      `SELECT ta.track_id, a.id, a.name, a.genres_json FROM track_artists ta JOIN artists a ON a.id = ta.artist_id`,
    )
    .all() as { track_id: string; id: string; name: string; genres_json: string | null }[];
  const byId = new Map<string, LibraryArtist>();
  for (const r of rows) {
    if (!ids.has(r.track_id)) continue;
    const a = byId.get(r.id);
    if (a) a.tracks++;
    else byId.set(r.id, { id: r.id, name: r.name, tracks: 1, genresJson: r.genres_json });
  }
  return [...byId.values()].sort((a, b) => b.tracks - a.tracks || a.name.localeCompare(b.name));
}

const SYNONYMS: Record<string, string> = {
  'hip-hop': 'hip hop',
  hiphop: 'hip hop',
  rnb: 'r&b',
  'r and b': 'r&b',
  'rhythm and blues': 'r&b',
  synthpop: 'synth-pop',
  'synth pop': 'synth-pop',
  'electro-pop': 'electropop',
  'drum & bass': 'drum and bass',
  "drum'n'bass": 'drum and bass',
  dnb: 'drum and bass',
};
const NOISE = new Set(['seen live', 'favorites', 'favourites', 'favorite', 'my favorite', 'awesome', 'love', 'beautiful', 'spotify']);

/** Lowercases, merges common synonyms and drops noise. Returns null for noise. */
export function normaliseTag(raw: string): string | null {
  const t = raw.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 40 || NOISE.has(t) || /^\d{4}$/.test(t)) return null;
  return SYNONYMS[t] ?? t;
}

/** For name matching across services: no case, accents, punctuation or leading "the". */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
