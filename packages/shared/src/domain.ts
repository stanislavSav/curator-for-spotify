// Core domain types shared by server and web. Vocabulary follows /CONTEXT.md.

export type TimeRange = 'short_term' | 'medium_term' | 'long_term';

export type PlaylistKind = 'owned' | 'followed' | 'generated';

export interface Playlist {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  ownerName: string;
  kind: PlaylistKind;
  /** False for Followed Playlists: Development Mode returns no items for them. */
  itemsReadable: boolean;
  itemsTotal: number;
  snapshotId: string;
  imageUrl: string | null;
  public: boolean;
  collaborative: boolean;
}

export interface Artist {
  id: string;
  name: string;
  genres: string[];
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  durationMs: number;
  isrc: string | null;
  albumName: string;
  releaseDate: string | null;
  artists: { id: string; name: string }[];
}

/** Per-track audio features from a third-party source (Spotify's are blocked). */
export interface AudioFeatures {
  trackId: string;
  source: 'reccobeats' | 'deezer' | 'manual';
  tempo: number | null;
  /** Pitch class 0–11 (C=0), Spotify convention. */
  key: number | null;
  /** 1 = major, 0 = minor. */
  mode: 0 | 1 | null;
  energy: number | null;
  danceability: number | null;
  valence: number | null;
  loudness: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
}

export interface Tag {
  tag: string;
  /** 0–1, normalised within its source. */
  weight: number;
  source: 'spotify-genre' | 'musicbrainz' | 'wikidata' | 'listenbrainz' | 'discogs';
}

export type JobKind = 'sync' | 'enrich' | 'snapshot' | 'history-import' | 'prune' | 'apply-proposals' | 'create-dj-set' | 'dj-ai-pass';
export type JobStatus = 'running' | 'done' | 'failed';

export interface Job {
  id: string;
  kind: JobKind;
  status: JobStatus;
  progress: number;
  total: number;
  message: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AuthStatus {
  configured: boolean;
  connected: boolean;
  user: { id: string; displayName: string } | null;
  /** Refresh tokens expire 6 months after login; ISO date. */
  reloginBy: string | null;
  redirectUri: string;
}

/** A track joined with everything we know about it. Returned by db/library.ts. */
export interface LibraryTrack extends Track {
  features: AudioFeatures | null;
  /** Merged track + artist tags, highest weight first. */
  tags: string[];
  likedAt: string | null;
  /** Owned/collaborative playlists (not removed) that contain the track. */
  playlistIds: string[];
  topRanks: Partial<Record<TimeRange, number>>;
}
