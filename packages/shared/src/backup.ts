import { z } from 'zod';

// Full Backup: one file with the user's work and, optionally, the library cache.
// Rows keep their DB column names, so export and import stay a plain copy.

export const FULL_BACKUP_FORMAT = 'spotify-curator-backup';
export const FULL_BACKUP_VERSION = 1;

/** Library cache tables, in insert order. Never included: auth (tokens) and jobs. */
export const LIBRARY_TABLES = [
  'tracks',
  'artists',
  'track_artists',
  'playlists',
  'playlist_items',
  'liked_tracks',
  'top_tracks',
  'top_artists',
  'recent_plays',
  'audio_features',
  'tags',
  'enrich_attempts',
  'stream_history',
] as const;
export type LibraryTable = (typeof LIBRARY_TABLES)[number];

/** File name for a Full Backup made at `exportedAt`. */
export const fullBackupFileName = (exportedAt: string) => `spotify-curator-backup-${exportedAt.slice(0, 10)}.json`;

// ---- rows -------------------------------------------------------------------------

const text = z.string();
const optText = z.string().nullable().default(null);

export const DjTemplateRowSchema = z.object({
  id: text,
  name: z.string().min(1),
  include_pool: z.number().int(),
  config_json: text,
  created_at: text,
  updated_at: text,
});
export const DjSetRowSchema = z.object({
  id: text,
  name: text,
  config_json: text,
  result_json: text,
  spotify_playlist_id: optText,
  created_at: text,
  status: z.enum(['draft', 'created']).default('created'),
  updated_at: optText,
});
export const ProposalStateRowSchema = z.object({
  proposal_id: text,
  status: z.enum(['pending', 'approved', 'dropped', 'created']),
  edited_json: optText,
  spotify_playlist_id: optText,
  updated_at: text,
});
export const BackupRowSchema = z.object({
  id: z.number().int(),
  playlist_id: text,
  name: text,
  created_at: text,
  json: text,
});
export const PruneLogRowSchema = z.object({
  playlist_id: text,
  kind: text,
  pruned_at: text,
  backup_id: z.number().int().nullable().default(null),
});
export const BackupRestoreRowSchema = z.object({
  backup_id: z.number().int(),
  restored_at: text,
  action: text,
  playlist_id: optText,
  url: optText,
});

export type DjTemplateRow = z.infer<typeof DjTemplateRowSchema>;
export type DjSetRow = z.infer<typeof DjSetRowSchema>;
export type ProposalStateRow = z.infer<typeof ProposalStateRowSchema>;
export type BackupRow = z.infer<typeof BackupRowSchema>;
export type PruneLogRow = z.infer<typeof PruneLogRowSchema>;
export type BackupRestoreRow = z.infer<typeof BackupRestoreRowSchema>;

/** One table as columns + rows (smaller than one object per row). */
export const TableDumpSchema = z.object({
  columns: z.array(z.string().min(1)).min(1),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});
export type TableDump = z.infer<typeof TableDumpSchema>;

/** The DJ page's current set (dj_workspace, one row). */
export const DjWorkspaceRowSchema = z.object({
  config_json: z.string(),
  seed: z.number().int(),
  result_json: z.string(),
  from_draft_json: z.string().nullable(),
  updated_at: z.string(),
});
export type DjWorkspaceRow = z.infer<typeof DjWorkspaceRowSchema>;

export const FullBackupWorkSchema = z.object({
  djTemplates: z.array(DjTemplateRowSchema).default([]),
  djSets: z.array(DjSetRowSchema).default([]),
  proposalState: z.array(ProposalStateRowSchema).default([]),
  /** Raw text of DATA_DIR/proposals.json, or null when there was none. */
  proposalsFile: z.string().nullable().default(null),
  backups: z.array(BackupRowSchema).default([]),
  pruneLog: z.array(PruneLogRowSchema).default([]),
  backupRestores: z.array(BackupRestoreRowSchema).default([]),
  /** Restored only when the device has no current DJ set, so an import never replaces work in progress. */
  djWorkspace: DjWorkspaceRowSchema.nullable().default(null),
});
export type FullBackupWork = z.infer<typeof FullBackupWorkSchema>;

export const FullBackupSchema = z.object({
  format: z.literal(FULL_BACKUP_FORMAT),
  version: z.literal(FULL_BACKUP_VERSION),
  exportedAt: z.string(),
  appVersion: z.string().default('0'),
  includesLibrary: z.boolean(),
  work: FullBackupWorkSchema,
  library: z.partialRecord(z.enum(LIBRARY_TABLES), TableDumpSchema).nullable().default(null),
  /** Browser-side settings, added by the web app before it saves the file. */
  client: z.object({ djConfig: z.unknown().nullable().default(null) }).default({ djConfig: null }),
});
export type FullBackup = z.infer<typeof FullBackupSchema>;

export type ParseFullBackupResult = { ok: true; backup: FullBackup } | { ok: false; error: string };

/** Checks format and version first, so the error says what is wrong in plain words. */
export function parseFullBackup(input: unknown): ParseFullBackupResult {
  const head = (input && typeof input === 'object' ? input : {}) as { format?: unknown; version?: unknown };
  if (head.format !== FULL_BACKUP_FORMAT) return { ok: false, error: 'This file is not a Spotify Curator Full Backup.' };
  if (typeof head.version === 'number' && head.version > FULL_BACKUP_VERSION)
    return {
      ok: false,
      error: `This Full Backup was made by a newer version of the app (format version ${head.version}). Update the app, then import it again.`,
    };
  if (head.version !== FULL_BACKUP_VERSION) return { ok: false, error: 'This Full Backup has an unknown format version.' };
  const parsed = FullBackupSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    return { ok: false, error: `The Full Backup file is damaged${where}: ${issue?.message ?? 'invalid content'}.` };
  }
  return { ok: true, backup: parsed.data };
}

// ---- import -----------------------------------------------------------------------

export const IMPORT_KINDS = [
  'djTemplates',
  'djSets',
  'proposalState',
  'proposalsFile',
  'backups',
  'pruneLog',
  'backupRestores',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const IMPORT_KIND_LABELS: Record<ImportKind, string> = {
  djTemplates: 'Set Templates',
  djSets: 'DJ Sets and Drafts',
  proposalState: 'Proposal decisions',
  proposalsFile: 'Proposals file',
  backups: 'Backups (pruned playlists)',
  pruneLog: 'Prune log',
  backupRestores: 'Backup restores',
};

export const CONFLICT_CHOICES = ['mine', 'theirs', 'both'] as const;
export const ConflictChoiceSchema = z.enum(CONFLICT_CHOICES);
/** mine = keep this device's item; theirs = use the backup's; both = import it as a copy. */
export type ConflictChoice = z.infer<typeof ConflictChoiceSchema>;

export interface ImportConflict {
  kind: ImportKind;
  key: string;
  label: string;
  /** Short description of this device's item. */
  mine: string;
  /** Short description of the backup's item. */
  theirs: string;
  /** False when a copy makes no sense (Proposal decisions, the Proposals file); 'both' then keeps mine. */
  canKeepBoth: boolean;
}

/** Key of a conflict in ImportRequest.choices. */
export const conflictChoiceKey = (c: Pick<ImportConflict, 'kind' | 'key'>) => `${c.kind}:${c.key}`;

export interface ImportKindSummary {
  new: number;
  conflicts: number;
  unchanged: number;
}

export interface ImportPreview {
  exportedAt: string;
  appVersion: string;
  formatVersion: number;
  summary: Record<ImportKind, ImportKindSummary>;
  conflicts: ImportConflict[];
  /** Row counts per library table: in the backup and on this device. Null when the file has no library cache. */
  library: { backup: Record<LibraryTable, number>; current: Record<LibraryTable, number> } | null;
  hasDjConfig: boolean;
  warnings: string[];
}

export const ImportRequestSchema = z.object({
  backup: z.unknown(),
  choices: z.record(z.string(), ConflictChoiceSchema).default({}),
  defaultChoice: ConflictChoiceSchema.default('mine'),
  importLibrary: z.boolean().default(false),
});
export type ImportRequest = z.input<typeof ImportRequestSchema>;

export interface ImportKindResult {
  added: number;
  replaced: number;
  keptBoth: number;
  /** Kept this device's item, or the item was already the same. */
  skipped: number;
}

export interface ImportResult {
  counts: Record<ImportKind, ImportKindResult>;
  library: { replaced: boolean; rows: number };
  /** The DJ page's current set: restored, kept (this device already had one), or not in the backup. */
  djWorkspace: 'restored' | 'kept-current' | 'none';
  /** Full Backup of the state before the import (relative to the project folder when possible). */
  autoBackup: string;
}
