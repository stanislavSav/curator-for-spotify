import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import {
  camelotLabel,
  keyName,
  toCamelot,
  type EnrichCoverage,
  type LibraryMissing,
  type LibrarySort,
  type LibraryTrackRow,
  type LibraryTracksPage,
  type LibraryTracksQuery,
} from '@curator/shared';
import type { DB } from '../../db/db.ts';
import { getLibraryTracks } from '../../db/library.ts';
import { historyByUri, SNAPSHOT_FILE } from './snapshot.ts';
import { isGenresStripped, libraryArtists, round2, taggedEntities } from './store.ts';

// The Library table works on an in-memory copy of getLibraryTracks. It is
// rebuilt when the DB fingerprint changes (sync, enrich, history import) or
// after a minute, so paging through 10k tracks stays fast.

interface IndexedRow {
  row: LibraryTrackRow;
  text: string;
  keySort: number | null;
}

interface CacheEntry {
  fingerprint: string;
  builtAt: number;
  rows: IndexedRow[];
}

const cache = new WeakMap<DB, CacheEntry>();
const TTL_MS = 60_000;

function fingerprint(db: DB): string {
  return JSON.stringify(
    db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM tracks) a, (SELECT COUNT(*) FROM track_artists) b,
           (SELECT COUNT(*) FROM audio_features) c, (SELECT MAX(fetched_at) FROM audio_features) d,
           (SELECT COUNT(*) FROM tags) e, (SELECT COUNT(*) FROM liked_tracks) f,
           (SELECT COUNT(*) FROM playlist_items) g, (SELECT COUNT(*) FROM playlists WHERE removed_at IS NULL) h,
           (SELECT COUNT(*) FROM top_tracks) i, (SELECT COUNT(*) FROM stream_history) j`,
      )
      .get(),
  );
}

export function libraryRows(db: DB, now = new Date()): IndexedRow[] {
  const fp = fingerprint(db);
  const hit = cache.get(db);
  if (hit && hit.fingerprint === fp && Date.now() - hit.builtAt < TTL_MS) return hit.rows;

  const history = historyByUri(db, now);
  const rows = getLibraryTracks(db).map((t): IndexedRow => {
    const f = t.features;
    const cam = toCamelot(f?.key, f?.mode);
    const ranks = Object.values(t.topRanks).filter((r): r is number => typeof r === 'number');
    const year = Number(t.releaseDate?.slice(0, 4));
    const row: LibraryTrackRow = {
      id: t.id,
      uri: t.uri,
      // Tracks pulled from Spotify's catalogue come back with no name or duration.
      name: t.name || '(no longer available on Spotify)',
      artists: t.artists.map((a) => a.name),
      album: t.albumName,
      year: year > 0 ? year : null,
      bpm: f?.tempo != null ? round2(f.tempo) : null,
      camelot: cam ? camelotLabel(cam) : null,
      keyName: cam ? keyName(f?.key, f?.mode) : null,
      energy: f?.energy != null ? round2(f.energy) : null,
      featuresSource: f?.source ?? null,
      tags: t.tags.slice(0, 6),
      likedAt: t.likedAt,
      topRank: ranks.length ? Math.min(...ranks) : null,
      playlists: t.playlistIds.length,
      plays12m: history.get(t.uri)?.plays12m ?? 0,
    };
    return {
      row,
      text: [t.name, t.albumName, ...row.artists, ...t.tags].join('\n').toLowerCase(),
      keySort: cam ? cam.number * 2 + (cam.letter === 'B' ? 1 : 0) : null,
    };
  });
  cache.set(db, { fingerprint: fp, builtAt: Date.now(), rows });
  return rows;
}

type SortValue = string | number | null;
const SORTS: Record<LibrarySort, (r: IndexedRow) => SortValue> = {
  name: (r) => r.row.name.toLowerCase(),
  artist: (r) => (r.row.artists[0] ?? '').toLowerCase(),
  bpm: (r) => r.row.bpm,
  key: (r) => r.keySort,
  energy: (r) => r.row.energy,
  liked: (r) => r.row.likedAt,
  plays: (r) => r.row.plays12m || null,
};

const MISSING: Record<LibraryMissing, (r: LibraryTrackRow) => boolean> = {
  features: (r) => r.featuresSource === null,
  bpm: (r) => r.bpm === null,
  tags: (r) => r.tags.length === 0,
};

export const isSort = (s: unknown): s is LibrarySort => typeof s === 'string' && s in SORTS;
export const isMissing = (s: unknown): s is LibraryMissing => typeof s === 'string' && s in MISSING;

/** Filters, sorts and pages the Library. Empty values sort last in both directions. */
export function queryLibrary(rows: IndexedRow[], query: LibraryTracksQuery): LibraryTracksPage {
  const terms = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const missing = query.missing ? MISSING[query.missing] : null;
  const filtered = rows.filter((r) => (!missing || missing(r.row)) && terms.every((t) => r.text.includes(t)));

  const key = SORTS[query.sort ?? 'artist'];
  const sign = query.dir === 'desc' ? -1 : 1;
  const sorted = filtered
    .map((r) => ({ r, v: key(r) }))
    .sort((a, b) => {
      if (a.v === b.v) return a.r.row.name.localeCompare(b.r.row.name);
      if (a.v === null) return 1;
      if (b.v === null) return -1;
      return (a.v < b.v ? -1 : 1) * sign;
    });

  const limit = Math.min(Math.max(Math.trunc(query.limit ?? 50), 1), 200);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return { total: sorted.length, offset, limit, rows: sorted.slice(offset, offset + limit).map((x) => x.r.row) };
}

function readSnapshotHead(file: string): EnrichCoverage['snapshot'] {
  if (!existsSync(file)) return null;
  const buf = Buffer.alloc(1024);
  const fd = openSync(file, 'r');
  try {
    const head = buf.subarray(0, readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
    const generatedAt = head.match(/"generatedAt":\s*"([^"]+)"/)?.[1];
    const tracks = Number(head.match(/"coverage":\s*\{"tracks":(\d+)/)?.[1] ?? 0);
    return generatedAt ? { generatedAt, tracks, bytes: statSync(file).size } : null;
  } finally {
    closeSync(fd);
  }
}

export function coverage(db: DB, snapshotFile = SNAPSHOT_FILE, now = new Date()): EnrichCoverage {
  const rows = libraryRows(db, now).map((r) => r.row);
  const count = (fn: (r: LibraryTrackRow) => boolean) => rows.filter(fn).length;
  const artists = libraryArtists(db);
  const tagged = (source: string) => {
    const set = taggedEntities(db, 'artist', source);
    return artists.filter((a) => set.has(a.id)).length;
  };
  const history = historyByUri(db, now);
  let plays12m = 0;
  for (const h of history.values()) plays12m += h.plays12m;
  const uris = new Set(rows.map((r) => r.uri));

  return {
    tracks: rows.length,
    withFeatures: count((r) => r.featuresSource !== null),
    withBpm: count((r) => r.bpm !== null),
    withKey: count((r) => r.camelot !== null),
    withEnergy: count((r) => r.energy !== null),
    withTags: count((r) => r.tags.length > 0),
    featuresBySource: {
      reccobeats: count((r) => r.featuresSource === 'reccobeats'),
      deezer: count((r) => r.featuresSource === 'deezer'),
      manual: count((r) => r.featuresSource === 'manual'),
    },
    artists: artists.length,
    artistTagsBySource: { spotifyGenre: tagged('spotify-genre'), musicbrainz: tagged('musicbrainz') },
    spotifyGenresStripped: isGenresStripped(db, now),
    history: {
      rows: (db.prepare('SELECT COUNT(*) FROM stream_history').pluck().get() as number) ?? 0,
      plays12m,
      tracksWithPlays: [...history.keys()].filter((u) => uris.has(u)).length,
    },
    snapshot: readSnapshotHead(snapshotFile),
  };
}
