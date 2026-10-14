// Owned by the library (enrich) feature. Types for /api/enrich.
import type { Job } from './domain.ts';

/** GET /api/enrich/coverage — how much of the Library is enriched. */
export interface EnrichCoverage {
  tracks: number;
  withFeatures: number;
  withBpm: number;
  withKey: number;
  withEnergy: number;
  withTags: number;
  /** Library tracks per audio-features source. */
  featuresBySource: { reccobeats: number; deezer: number; manual: number };
  artists: number;
  /** Library artists that have at least one tag, per tag source. */
  artistTagsBySource: { spotifyGenre: number; musicbrainz: number };
  /** Spotify returned empty genres for the first artists, so the job stopped asking. */
  spotifyGenresStripped: boolean;
  history: {
    rows: number;
    /** Plays ≥30 s in the last 12 months, all tracks. */
    plays12m: number;
    /** Library tracks with at least one play ≥30 s. */
    tracksWithPlays: number;
  };
  snapshot: { generatedAt: string; tracks: number; bytes: number } | null;
}

export type LibrarySort = 'name' | 'artist' | 'bpm' | 'key' | 'energy' | 'liked' | 'plays';
export type LibraryMissing = 'features' | 'bpm' | 'tags';

export interface LibraryTracksQuery {
  q?: string;
  sort?: LibrarySort;
  dir?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  missing?: LibraryMissing;
}

/** One row of the Library table. */
export interface LibraryTrackRow {
  id: string;
  uri: string;
  name: string;
  artists: string[];
  album: string;
  year: number | null;
  bpm: number | null;
  /** Camelot label, e.g. "8A". */
  camelot: string | null;
  keyName: string | null;
  energy: number | null;
  featuresSource: 'reccobeats' | 'deezer' | 'manual' | null;
  tags: string[];
  likedAt: string | null;
  /** Best (lowest) rank across the three top-track time ranges. */
  topRank: number | null;
  playlists: number;
  plays12m: number;
}

export interface LibraryTracksPage {
  total: number;
  offset: number;
  limit: number;
  rows: LibraryTrackRow[];
}

export type EnrichSourceId = 'reccobeats' | 'deezer' | 'spotify-genre' | 'musicbrainz' | 'wikidata';

/** One row of the Enrich panel: how far one source got and why the rest is missing. */
export interface EnrichSourceStatus {
  id: EnrichSourceId;
  label: string;
  /** What the source adds, e.g. "BPM, key, energy, mood". */
  provides: string;
  unit: 'tracks' | 'artists';
  /** Items this source should look at. */
  total: number;
  /** Items that got data from this source. */
  done: number;
  /** Looked up, but the source has no data. Retried after `retryAfterDays`. */
  notFound: number;
  /** Not looked up yet. The next run does these. */
  waiting: number;
  /** Items this source can't look up (e.g. no ISRC). */
  skipped: number;
  skippedReason: string | null;
  /** Earliest date a "not found" item is tried again. */
  nextRetryAt: string | null;
  /** Rough time to finish `waiting`, in minutes. */
  etaMinutes: number | null;
  state: 'complete' | 'pending' | 'unavailable';
  note: string | null;
}

/** GET /api/enrich/status */
export interface EnrichStatus {
  retryAfterDays: number;
  sources: EnrichSourceStatus[];
  /** What is still missing in the Library, and why. */
  gaps: {
    tracks: number;
    noBpm: number;
    noKey: number;
    noTags: number;
    /** No BPM: ReccoBeats and Deezer both had nothing. */
    noBpmBothNotFound: number;
    /** No BPM: not looked up yet. */
    noBpmWaiting: number;
    /** No BPM: not in ReccoBeats and no ISRC for Deezer. */
    noBpmNoIsrc: number;
  };
  runs: Job[];
}
