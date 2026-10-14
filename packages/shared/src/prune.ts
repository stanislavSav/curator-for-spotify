// Owned by the prune feature. Types for its API and files.
import { z } from 'zod';
import type { Job } from './domain.ts';

export const RECOVER_PLAYLISTS_URL = 'https://www.spotify.com/account/recover-playlists/';
export const DEFAULT_PRUNE_MONTHS = 12;
/** A Streaming History play counts as Usage Evidence only from this length. */
export const MIN_PLAY_MS = 30_000;

// ---- Streaming History import ------------------------------------------------

export interface HistoryImportResult {
  files: { name: string; format: 'extended' | 'legacy' | 'unknown'; rows: number }[];
  /** Rows read from the files, before any filtering. */
  rowsRead: number;
  /** Rows that were written (new). */
  inserted: number;
  /** Rows already in the database (same ts + track). */
  duplicates: number;
  /** Podcast, audiobook and video rows, and rows without a track URI. */
  skipped: number;
  /** Old account-data format (no URI): rows matched to a library track by artist + title. */
  legacy: { rows: number; matched: number; unmatched: number } | null;
  firstTs: string | null;
  lastTs: string | null;
}

export interface HistoryImportResponse {
  /** Set for a small upload that was imported at once. */
  result?: HistoryImportResult;
  /** Set for a large upload that runs as a 'history-import' job. */
  job?: Job;
}

export interface HistorySummary {
  rows: number;
  firstTs: string | null;
  lastTs: string | null;
  distinctTracks: number;
  /** Distinct history tracks that are in the synced tracks table. */
  matchedTracks: number;
  /** 0–100. */
  matchedPct: number;
}

// ---- Usage Evidence and Prune Candidates ---------------------------------------

export type PruneGroup = 'candidate' | 'no-evidence' | 'keep';
export type EvidenceSource = 'context' | 'exclusive' | 'edit';

export interface UsageEvidence {
  /** Plays from the playlist context in Recently Played (last 50 plays at sync time). */
  context: { lastPlayed: string; plays: number } | null;
  /** Null when the playlist's tracks can't be read. */
  exclusive: {
    /** Exclusive Tracks in this playlist. */
    tracks: number;
    /** Latest Streaming History play (≥30 s) of any Exclusive Track. */
    lastPlayed: string | null;
    /** Plays (≥30 s) of Exclusive Tracks since the cutoff. */
    playsInWindow: number;
  } | null;
  /** Latest added_at of the playlist's items (by the user, for playlists they don't own). */
  edit: { lastAdded: string } | null;
}

export interface PruneCandidate {
  id: string;
  name: string;
  kind: 'owned' | 'followed';
  ownerName: string;
  trackCount: number;
  collaborative: boolean;
  imageUrl: string | null;
  group: PruneGroup;
  /** Ticked by default in the UI. Never true for 'no-evidence' or 'keep'. */
  preselect: boolean;
  lastUsed: string | null;
  lastUsedSource: EvidenceSource | null;
  evidence: UsageEvidence;
  /** Why the playlist is in its group. */
  reasons: string[];
  /** How far the evidence can be trusted. */
  notes: string[];
}

export interface PruneCandidatesResponse {
  months: number;
  /** ISO; evidence older than this is "old". */
  cutoff: string;
  generatedAt: string;
  history: HistorySummary;
  /** Earliest Recently Played row, i.e. how far back context evidence goes. */
  recentPlaysSince: string | null;
  /** Generated Playlists left out (they are never Prune Candidates). */
  excludedGenerated: number;
  playlists: PruneCandidate[];
}

// ---- Prune, Backup, Restore ----------------------------------------------------

export const PruneRequestSchema = z.object({
  playlistIds: z.array(z.string().min(1)).min(1).max(500),
});
export type PruneRequest = z.infer<typeof PruneRequestSchema>;

export interface PruneResult {
  playlistId: string;
  name: string;
  kind: 'owned' | 'followed' | null;
  status: 'pending' | 'done' | 'failed';
  action: 'deleted' | 'unfollowed' | null;
  backupId: number | null;
  backupFile: string | null;
  /** Where the backed-up track list came from. */
  tracksFrom: 'spotify' | 'database' | 'none' | null;
  trackCount: number;
  error: string | null;
}

export interface PruneJobResponse {
  job: Job;
}

export interface PruneResultsResponse {
  jobId: string;
  results: PruneResult[];
}

/** The JSON written to data/backups/<date>-<id>-<slug>.json and the backups table. */
export interface PlaylistBackup {
  version: 1;
  playlistId: string;
  uri: string;
  name: string;
  description: string;
  kind: 'owned' | 'followed';
  owner: { id: string; name: string };
  public: boolean;
  collaborative: boolean;
  createdAt: string;
  tracksFrom: 'spotify' | 'database' | 'none';
  /** Item URIs in playlist order. Local files keep their spotify:local: URI. */
  uris: string[];
}

export interface BackupInfo {
  id: number;
  playlistId: string;
  name: string;
  kind: 'owned' | 'followed';
  ownerName: string;
  trackCount: number;
  createdAt: string;
  file: string | null;
  restored: { at: string; playlistId: string | null; url: string | null } | null;
}

export interface RestoreResult {
  backupId: number;
  action: 'refollowed' | 'recreated';
  playlistId: string;
  url: string;
  /** Tracks added to a recreated playlist. */
  added: number;
  /** Local files and other URIs that the API can't add. */
  skipped: number;
}
