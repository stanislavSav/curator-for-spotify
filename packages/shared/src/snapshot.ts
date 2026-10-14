// data/snapshot.json — the compact Library copy an Agent reads to write Proposals
// (see docs/adr/0001). Keep keys short: the file must fit an LLM context for
// a few thousand tracks. Produced by the enrich feature.

export const SNAPSHOT_VERSION = 1;

export interface SnapshotPlaylist {
  id: string;
  name: string;
  kind: 'owned' | 'followed' | 'generated';
  n: number; // track count
  desc?: string;
}

export interface SnapshotTrack {
  id: string;
  name: string;
  artists: string[];
  year?: number;
  dur: number; // seconds
  liked?: string; // ISO date added to Liked Songs
  pl?: string[]; // ids of Owned Playlists containing it
  top?: { s?: number; m?: number; l?: number }; // rank in short/medium/long-term top tracks
  plays12m?: number; // Streaming History plays ≥30 s in the last 12 months
  lastPlayed?: string; // ISO date
  bpm?: number;
  cam?: string; // Camelot, e.g. "8A"
  energy?: number; // 0–1, 2 decimals
  valence?: number;
  dance?: number;
  acoustic?: number;
  instr?: number;
  tags?: string[]; // most relevant first, max 6 (track tags, then artist genres/tags)
}

export interface Snapshot {
  version: typeof SNAPSHOT_VERSION;
  generatedAt: string;
  user: string;
  coverage: { tracks: number; withFeatures: number; withTags: number; withHistory: number };
  playlists: SnapshotPlaylist[];
  topArtists: { s: string[]; m: string[]; l: string[] };
  tagCounts: [tag: string, count: number][];
  tracks: SnapshotTrack[];
}
