import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  FULL_BACKUP_FORMAT,
  FULL_BACKUP_VERSION,
  IMPORT_KINDS,
  LIBRARY_TABLES,
  conflictChoiceKey,
  type BackupRestoreRow,
  type BackupRow,
  type ConflictChoice,
  type DjSetRow,
  type DjTemplateRow,
  type DjWorkspaceRow,
  type FullBackup,
  type FullBackupWork,
  type ImportConflict,
  type ImportKind,
  type ImportKindResult,
  type ImportKindSummary,
  type ImportPreview,
  type ImportResult,
  type LibraryTable,
  type ProposalStateRow,
  type PruneLogRow,
  type TableDump,
} from '@curator/shared';
import { DATA_DIR, ROOT_DIR, nowIso, type DB } from '../../db/db.ts';
import { backupFileName } from '../prune/prune.ts';

export class FullBackupError extends Error {
  constructor(
    readonly status: 400 | 409,
    message: string,
  ) {
    super(message);
  }
}

const paths = (dataDir: string) => ({
  proposals: resolve(dataDir, 'proposals.json'),
  backups: resolve(dataDir, 'backups'),
  fullBackups: resolve(dataDir, 'full-backups'),
});

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

export function appVersion(): string {
  try {
    const v = (JSON.parse(readFileSync(resolve(ROOT_DIR, 'package.json'), 'utf8')) as { version?: unknown }).version;
    return typeof v === 'string' ? v : '0';
  } catch {
    return '0';
  }
}

// ---- export -----------------------------------------------------------------------

export function readWork(db: DB, dataDir: string): FullBackupWork {
  const all = <T>(sql: string) => db.prepare(sql).all() as T[];
  return {
    djTemplates: all<DjTemplateRow>('SELECT id, name, include_pool, config_json, created_at, updated_at FROM dj_templates ORDER BY name'),
    djSets: all<DjSetRow>(
      'SELECT id, name, config_json, result_json, spotify_playlist_id, created_at, status, updated_at FROM dj_sets ORDER BY created_at',
    ),
    proposalState: all<ProposalStateRow>(
      'SELECT proposal_id, status, edited_json, spotify_playlist_id, updated_at FROM proposal_state ORDER BY proposal_id',
    ),
    proposalsFile: readText(paths(dataDir).proposals),
    backups: all<BackupRow>('SELECT id, playlist_id, name, created_at, json FROM backups ORDER BY id'),
    pruneLog: all<PruneLogRow>('SELECT playlist_id, kind, pruned_at, backup_id FROM prune_log ORDER BY rowid'),
    backupRestores: all<BackupRestoreRow>(
      'SELECT backup_id, restored_at, action, playlist_id, url FROM backup_restores ORDER BY rowid',
    ),
    djWorkspace:
      (db.prepare('SELECT config_json, seed, result_json, from_draft_json, updated_at FROM dj_workspace WHERE id = 1').get() as
        | DjWorkspaceRow
        | undefined) ?? null,
  };
}

function dumpTable(db: DB, table: LibraryTable): TableDump {
  const stmt = db.prepare(`SELECT * FROM ${table}`).raw(true);
  return { columns: stmt.columns().map((c) => c.name), rows: stmt.all() as TableDump['rows'] };
}

export function exportFullBackup(db: DB, opts: { includeLibrary: boolean; dataDir?: string; now?: string }): FullBackup {
  const dataDir = opts.dataDir ?? DATA_DIR;
  // One read transaction: a sync running at the same time cannot tear the copy.
  return db.transaction(() => ({
    format: FULL_BACKUP_FORMAT,
    version: FULL_BACKUP_VERSION,
    exportedAt: opts.now ?? nowIso(),
    appVersion: appVersion(),
    includesLibrary: opts.includeLibrary,
    work: readWork(db, dataDir),
    library: opts.includeLibrary
      ? (Object.fromEntries(LIBRARY_TABLES.map((t) => [t, dumpTable(db, t)])) as Record<LibraryTable, TableDump>)
      : null,
    client: { djConfig: null },
  }))() as FullBackup;
}

// ---- plan ---------------------------------------------------------------------------

type ItemStatus = 'new' | 'unchanged' | 'conflict';

interface PlanItem<T> {
  status: ItemStatus;
  theirs: T;
  /** This device's matching row, for unchanged and conflict items. */
  mine?: T;
  conflict?: ImportConflict;
}

interface ImportPlan {
  djTemplates: PlanItem<DjTemplateRow>[];
  djSets: PlanItem<DjSetRow>[];
  proposalState: PlanItem<ProposalStateRow>[];
  proposalsFile: PlanItem<string>[];
  backups: PlanItem<BackupRow>[];
  pruneLog: PlanItem<PruneLogRow>[];
  backupRestores: PlanItem<BackupRestoreRow>[];
}

const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'unknown date');

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function countTracks(resultJson: string): number | null {
  const tracks = (safeJson(resultJson) as { tracks?: unknown } | null)?.tracks;
  return Array.isArray(tracks) ? tracks.length : null;
}

function describeTemplate(t: DjTemplateRow) {
  return `${t.include_pool ? 'Settings and Pool' : 'Settings only'}, saved ${day(t.updated_at)}`;
}

function describeSet(s: DjSetRow) {
  const n = countTracks(s.result_json);
  return `${s.status === 'draft' ? 'Draft' : 'Created on Spotify'}${n === null ? '' : `, ${n} tracks`}, saved ${day(s.updated_at ?? s.created_at)}`;
}

function describeDecision(p: ProposalStateRow) {
  return `${p.status[0]!.toUpperCase()}${p.status.slice(1)}${p.edited_json ? ', edited' : ''}, ${day(p.updated_at)}`;
}

function describeProposalsFile(text: string) {
  const file = safeJson(text) as { proposals?: unknown; generatedAt?: unknown } | null;
  if (!file || !Array.isArray(file.proposals)) return `${Math.ceil(text.length / 1024)} KB, not readable as Proposals`;
  const when = typeof file.generatedAt === 'string' ? `, written ${day(file.generatedAt)}` : '';
  return `${file.proposals.length} Proposals${when}`;
}

function describeBackup(b: BackupRow) {
  const uris = (safeJson(b.json) as { uris?: unknown } | null)?.uris;
  return `${Array.isArray(uris) ? `${uris.length} tracks` : 'Backup'}, saved ${day(b.created_at)}`;
}

function proposalNames(...files: (string | null)[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const text of files) {
    const list = text ? (safeJson(text) as { proposals?: unknown } | null)?.proposals : null;
    if (!Array.isArray(list)) continue;
    for (const p of list as { id?: unknown; name?: unknown }[])
      if (typeof p?.id === 'string' && typeof p.name === 'string' && !names.has(p.id)) names.set(p.id, p.name);
  }
  return names;
}

const same = (a: object, b: object) => JSON.stringify(a) === JSON.stringify(b);

function item<T extends object | string>(
  theirs: T,
  mine: T | undefined,
  equal: (a: T, b: T) => boolean,
  conflict: () => Omit<ImportConflict, 'mine' | 'theirs'> & { mine: string; theirs: string },
): PlanItem<T> {
  if (mine === undefined) return { status: 'new', theirs };
  if (equal(theirs, mine)) return { status: 'unchanged', theirs, mine };
  return { status: 'conflict', theirs, mine, conflict: conflict() };
}

const backupKey = (b: Pick<BackupRow, 'playlist_id' | 'created_at'>) => `${b.playlist_id}@${b.created_at}`;
const pruneLogKey = (r: PruneLogRow) => `${r.playlist_id}|${r.kind}|${r.pruned_at}`;

function buildPlan(db: DB, work: FullBackupWork, dataDir: string): ImportPlan {
  const mine = readWork(db, dataDir);

  const templatesByName = new Map(mine.djTemplates.map((t) => [t.name.toLowerCase(), t]));
  const setsById = new Map(mine.djSets.map((s) => [s.id, s]));
  const stateById = new Map(mine.proposalState.map((p) => [p.proposal_id, p]));
  const backupsByKey = new Map(mine.backups.map((b) => [backupKey(b), b]));
  const names = proposalNames(work.proposalsFile, mine.proposalsFile);

  const djTemplates = work.djTemplates.map((t) =>
    item(
      t,
      templatesByName.get(t.name.toLowerCase()),
      (a, b) => a.include_pool === b.include_pool && a.config_json === b.config_json,
      () => {
        const m = templatesByName.get(t.name.toLowerCase())!;
        return { kind: 'djTemplates', key: t.name.toLowerCase(), label: t.name, mine: describeTemplate(m), theirs: describeTemplate(t), canKeepBoth: true };
      },
    ),
  );
  const djSets = work.djSets.map((s) =>
    item(s, setsById.get(s.id), same, () => {
      const m = setsById.get(s.id)!;
      const label = m.name === s.name ? s.name : `${m.name} / ${s.name}`;
      return { kind: 'djSets', key: s.id, label, mine: describeSet(m), theirs: describeSet(s), canKeepBoth: true };
    }),
  );
  const proposalState = work.proposalState.map((p) =>
    item(p, stateById.get(p.proposal_id), same, () => ({
      kind: 'proposalState',
      key: p.proposal_id,
      label: names.get(p.proposal_id) ?? p.proposal_id,
      mine: describeDecision(stateById.get(p.proposal_id)!),
      theirs: describeDecision(p),
      canKeepBoth: false,
    })),
  );
  const proposalsFile =
    work.proposalsFile === null
      ? []
      : [
          item(work.proposalsFile, mine.proposalsFile ?? undefined, (a, b) => a.trim() === b.trim(), () => ({
            kind: 'proposalsFile',
            key: 'proposals.json',
            label: 'Proposals file',
            mine: describeProposalsFile(mine.proposalsFile!),
            theirs: describeProposalsFile(work.proposalsFile!),
            canKeepBoth: false,
          })),
        ];
  const backups = work.backups.map((b) =>
    item(
      b,
      backupsByKey.get(backupKey(b)),
      (x, y) => x.name === y.name && x.json === y.json,
      () => ({
        kind: 'backups',
        key: backupKey(b),
        label: b.name,
        mine: describeBackup(backupsByKey.get(backupKey(b))!),
        theirs: describeBackup(b),
        canKeepBoth: true,
      }),
    ),
  );
  // Logs never conflict: a row is either already here or new.
  const myLog = new Set(mine.pruneLog.map(pruneLogKey));
  const pruneLog = work.pruneLog.map((r): PlanItem<PruneLogRow> => ({ status: myLog.has(pruneLogKey(r)) ? 'unchanged' : 'new', theirs: r }));
  const theirBackups = new Map(work.backups.map((b) => [b.id, b]));
  const myRestores = new Set(mine.backupRestores.map((r) => `${r.backup_id}|${r.restored_at}|${r.action}`));
  const backupRestores = work.backupRestores.map((r): PlanItem<BackupRestoreRow> => {
    const source = theirBackups.get(r.backup_id);
    const myId = source ? backupsByKey.get(backupKey(source))?.id : undefined;
    const known = myId !== undefined && myRestores.has(`${myId}|${r.restored_at}|${r.action}`);
    return { status: known ? 'unchanged' : 'new', theirs: r };
  });

  return { djTemplates, djSets, proposalState, proposalsFile, backups, pruneLog, backupRestores };
}

// ---- preview -----------------------------------------------------------------------

function tableCounts(db: DB): Record<LibraryTable, number> {
  return Object.fromEntries(
    LIBRARY_TABLES.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  ) as Record<LibraryTable, number>;
}

const isNewer = (theirs: string, ours: string) => {
  const parts = (v: string) => v.split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0);
  const [a, b] = [parts(theirs), parts(ours)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

export function previewImport(db: DB, backup: FullBackup, opts: { dataDir?: string } = {}): ImportPreview {
  const plan = buildPlan(db, backup.work, opts.dataDir ?? DATA_DIR);
  const summary = Object.fromEntries(
    IMPORT_KINDS.map((kind) => {
      const items = plan[kind] as PlanItem<unknown>[];
      const count = (s: ItemStatus) => items.filter((i) => i.status === s).length;
      return [kind, { new: count('new'), conflicts: count('conflict'), unchanged: count('unchanged') } satisfies ImportKindSummary];
    }),
  ) as Record<ImportKind, ImportKindSummary>;
  const conflicts = IMPORT_KINDS.flatMap((kind) => (plan[kind] as PlanItem<unknown>[]).flatMap((i) => (i.conflict ? [i.conflict] : [])));

  const warnings: string[] = [];
  if (isNewer(backup.appVersion, appVersion()))
    warnings.push(`This file comes from a newer app version (${backup.appVersion}). Update the app on this device if the import misses something.`);
  if (!backup.library) warnings.push('No library cache in this file. Run Sync and Enrich on this device after the import.');
  const missing = backup.library ? LIBRARY_TABLES.filter((t) => !backup.library![t]) : [];
  if (missing.length) warnings.push(`The library cache in this file has no ${missing.join(', ')}. Those tables will be empty if you replace your library cache.`);
  if (backup.work.proposalsFile === null) warnings.push('No Proposals file in this file.');
  if (backup.work.backupRestores.some((r) => !backup.work.backups.some((b) => b.id === r.backup_id)))
    warnings.push('Some Backup restores refer to Backups that are not in this file. They will be skipped.');

  return {
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    formatVersion: backup.version,
    summary,
    conflicts,
    library: backup.library
      ? {
          backup: Object.fromEntries(LIBRARY_TABLES.map((t) => [t, backup.library![t]?.rows.length ?? 0])) as Record<LibraryTable, number>,
          current: tableCounts(db),
        }
      : null,
    hasDjConfig: backup.client.djConfig !== null && backup.client.djConfig !== undefined,
    warnings,
  };
}

// ---- import ------------------------------------------------------------------------

export interface ImportOptions {
  choices?: Record<string, ConflictChoice>;
  defaultChoice?: ConflictChoice;
  importLibrary?: boolean;
  dataDir?: string;
  now?: Date;
}

const emptyCounts = (): Record<ImportKind, ImportKindResult> =>
  Object.fromEntries(IMPORT_KINDS.map((k) => [k, { added: 0, replaced: 0, keptBoth: 0, skipped: 0 }])) as Record<
    ImportKind,
    ImportKindResult
  >;

function uniqueTemplateName(db: DB, base: string): string {
  const taken = (n: string) => Boolean(db.prepare('SELECT 1 FROM dj_templates WHERE lower(name) = lower(?)').get(n));
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
}

function writeAtomic(path: string, content: string) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function displayPath(path: string) {
  const rel = relative(ROOT_DIR, path);
  return rel.startsWith('..') || isAbsolute(rel) ? path : rel;
}

/** Writes a Full Backup (work and library) of the current state to DATA_DIR/full-backups/. */
export function writeAutoBackup(db: DB, dataDir: string, now: Date): string {
  const dir = paths(dataDir).fullBackups;
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `auto-before-import-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(exportFullBackup(db, { includeLibrary: true, dataDir, now: now.toISOString() })));
  return file;
}

function replaceLibrary(db: DB, library: NonNullable<FullBackup['library']>): number {
  let rows = 0;
  for (const table of [...LIBRARY_TABLES].reverse()) db.prepare(`DELETE FROM ${table}`).run();
  for (const table of LIBRARY_TABLES) {
    const dump = library[table];
    if (!dump) continue;
    const known = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
    const unknown = dump.columns.find((c) => !known.has(c));
    if (unknown) throw new FullBackupError(400, `The library cache has an unknown column "${unknown}" in ${table}.`);
    const insert = db.prepare(
      `INSERT INTO ${table} (${dump.columns.map((c) => `"${c}"`).join(', ')}) VALUES (${dump.columns.map(() => '?').join(', ')})`,
    );
    for (const row of dump.rows) {
      if (row.length !== dump.columns.length) throw new FullBackupError(400, `The library cache has a broken row in ${table}.`);
      insert.run(row);
      rows++;
    }
  }
  return rows;
}

/**
 * Merges a Full Backup into this device. Conflicts follow `choices` (key: kind:key),
 * else `defaultChoice`. All DB changes run in one transaction; an automatic Full
 * Backup of the current state is written first.
 */
export function applyImport(db: DB, backup: FullBackup, opts: ImportOptions = {}): ImportResult {
  const running = db.prepare("SELECT kind FROM jobs WHERE status = 'running' LIMIT 1").get() as { kind: string } | undefined;
  if (running) throw new FullBackupError(409, `A ${running.kind} job is running. Wait until it finishes, then import again.`);
  const importLibrary = Boolean(opts.importLibrary && backup.library);
  const dataDir = opts.dataDir ?? DATA_DIR;
  const now = opts.now ?? new Date();
  const dir = paths(dataDir);
  const choiceFor = (c: ImportConflict | undefined): ConflictChoice => {
    const choice = (c && opts.choices?.[conflictChoiceKey(c)]) ?? opts.defaultChoice ?? 'mine';
    return choice === 'both' && !c?.canKeepBoth ? 'mine' : choice;
  };

  const autoBackup = writeAutoBackup(db, dataDir, now);
  const counts = emptyCounts();
  let libraryRows = 0;
  let djWorkspace: ImportResult['djWorkspace'] = 'none';
  const backupFiles: { path: string; json: string; overwrite: boolean }[] = [];

  db.transaction(() => {
    const plan = buildPlan(db, backup.work, dataDir);

    // Set Templates (matched by name)
    const insertTemplate = db.prepare(
      'INSERT INTO dj_templates (id, name, include_pool, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const freeTemplateId = (id: string) => (db.prepare('SELECT 1 FROM dj_templates WHERE id = ?').get(id) ? randomUUID() : id);
    for (const it of plan.djTemplates) {
      const t = it.theirs;
      const c = counts.djTemplates;
      if (it.status === 'new') {
        insertTemplate.run(freeTemplateId(t.id), t.name, t.include_pool, t.config_json, t.created_at, t.updated_at);
        c.added++;
        continue;
      }
      const choice = it.status === 'conflict' ? choiceFor(it.conflict) : 'mine';
      if (choice === 'mine') c.skipped++;
      else if (choice === 'theirs') {
        db.prepare('UPDATE dj_templates SET name = ?, include_pool = ?, config_json = ?, updated_at = ? WHERE id = ?').run(
          t.name,
          t.include_pool,
          t.config_json,
          t.updated_at,
          it.mine!.id,
        );
        c.replaced++;
      } else {
        insertTemplate.run(randomUUID(), uniqueTemplateName(db, `${t.name} (imported)`), t.include_pool, t.config_json, t.created_at, t.updated_at);
        c.keptBoth++;
      }
    }

    // DJ Sets and Drafts (matched by id)
    const insertSet = db.prepare(
      `INSERT INTO dj_sets (id, name, config_json, result_json, spotify_playlist_id, created_at, status, updated_at)
       VALUES (@id, @name, @config_json, @result_json, @spotify_playlist_id, @created_at, @status, @updated_at)`,
    );
    for (const it of plan.djSets) {
      const s = it.theirs;
      const c = counts.djSets;
      if (it.status === 'new') {
        insertSet.run(s);
        c.added++;
        continue;
      }
      const choice = it.status === 'conflict' ? choiceFor(it.conflict) : 'mine';
      if (choice === 'mine') c.skipped++;
      else if (choice === 'theirs') {
        db.prepare(
          `UPDATE dj_sets SET name = @name, config_json = @config_json, result_json = @result_json,
             spotify_playlist_id = @spotify_playlist_id, created_at = @created_at, status = @status, updated_at = @updated_at
           WHERE id = @id`,
        ).run(s);
        c.replaced++;
      } else {
        insertSet.run({ ...s, id: randomUUID(), name: `${s.name} (imported)` });
        c.keptBoth++;
      }
    }

    // Proposal decisions (matched by Proposal id)
    const upsertState = db.prepare(
      `INSERT INTO proposal_state (proposal_id, status, edited_json, spotify_playlist_id, updated_at)
       VALUES (@proposal_id, @status, @edited_json, @spotify_playlist_id, @updated_at)
       ON CONFLICT(proposal_id) DO UPDATE SET status = excluded.status, edited_json = excluded.edited_json,
         spotify_playlist_id = excluded.spotify_playlist_id, updated_at = excluded.updated_at`,
    );
    for (const it of plan.proposalState) {
      const c = counts.proposalState;
      if (it.status === 'new') {
        upsertState.run(it.theirs);
        c.added++;
      } else if (it.status === 'conflict' && choiceFor(it.conflict) === 'theirs') {
        upsertState.run(it.theirs);
        c.replaced++;
      } else c.skipped++;
    }

    // Backups (matched by playlist and time); keep a map of their ids to ours for the logs.
    const backupIds = new Map<number, number>();
    const insertBackup = db.prepare('INSERT INTO backups (id, playlist_id, name, created_at, json) VALUES (?, ?, ?, ?, ?)');
    const idFree = (id: number) => !db.prepare('SELECT 1 FROM backups WHERE id = ?').get(id);
    const addBackup = (b: BackupRow) =>
      Number(insertBackup.run(idFree(b.id) ? b.id : null, b.playlist_id, b.name, b.created_at, b.json).lastInsertRowid);
    const fileOf = (b: BackupRow) => resolve(dir.backups, backupFileName(b.created_at, b.playlist_id, b.name));
    for (const it of plan.backups) {
      const b = it.theirs;
      const c = counts.backups;
      if (it.status === 'new') {
        backupIds.set(b.id, addBackup(b));
        backupFiles.push({ path: fileOf(b), json: b.json, overwrite: false });
        c.added++;
        continue;
      }
      const mine = it.mine!;
      const choice = it.status === 'conflict' ? choiceFor(it.conflict) : 'mine';
      if (choice === 'mine') {
        backupIds.set(b.id, mine.id);
        backupFiles.push({ path: fileOf(mine), json: mine.json, overwrite: false });
        c.skipped++;
      } else if (choice === 'theirs') {
        db.prepare('UPDATE backups SET name = ?, json = ? WHERE id = ?').run(b.name, b.json, mine.id);
        backupIds.set(b.id, mine.id);
        backupFiles.push({ path: fileOf(b), json: b.json, overwrite: true });
        c.replaced++;
      } else {
        backupIds.set(b.id, Number(insertBackup.run(null, b.playlist_id, b.name, b.created_at, b.json).lastInsertRowid));
        c.keptBoth++;
      }
    }

    const insertLog = db.prepare('INSERT INTO prune_log (playlist_id, kind, pruned_at, backup_id) VALUES (?, ?, ?, ?)');
    for (const it of plan.pruneLog) {
      if (it.status !== 'new') {
        counts.pruneLog.skipped++;
        continue;
      }
      const r = it.theirs;
      insertLog.run(r.playlist_id, r.kind, r.pruned_at, r.backup_id === null ? null : (backupIds.get(r.backup_id) ?? null));
      counts.pruneLog.added++;
    }

    const restoreExists = db.prepare('SELECT 1 FROM backup_restores WHERE backup_id = ? AND restored_at = ? AND action = ?');
    const insertRestore = db.prepare(
      'INSERT INTO backup_restores (backup_id, restored_at, action, playlist_id, url) VALUES (?, ?, ?, ?, ?)',
    );
    for (const { theirs: r } of plan.backupRestores) {
      const id = backupIds.get(r.backup_id);
      if (id === undefined || restoreExists.get(id, r.restored_at, r.action)) {
        counts.backupRestores.skipped++;
        continue;
      }
      insertRestore.run(id, r.restored_at, r.action, r.playlist_id, r.url);
      counts.backupRestores.added++;
    }

    if (importLibrary) libraryRows = replaceLibrary(db, backup.library!);

    // Files last: if writing fails, the DB changes roll back.
    for (const f of backupFiles) {
      if (!f.overwrite && existsSync(f.path)) continue;
      mkdirSync(dir.backups, { recursive: true });
      writeFileSync(f.path, f.json);
    }
    const pf = plan.proposalsFile[0];
    if (pf) {
      const take = pf.status === 'new' || (pf.status === 'conflict' && choiceFor(pf.conflict) === 'theirs');
      if (take) {
        mkdirSync(dataDir, { recursive: true });
        writeAtomic(dir.proposals, pf.theirs);
        counts.proposalsFile[pf.status === 'new' ? 'added' : 'replaced']++;
      } else counts.proposalsFile.skipped++;
    }

    // The DJ page's current set: only into an empty workspace, never over work in progress.
    const ws = backup.work.djWorkspace;
    if (ws) {
      const hasCurrent = db.prepare('SELECT 1 FROM dj_workspace WHERE id = 1').get() != null;
      if (hasCurrent) djWorkspace = 'kept-current';
      else {
        db.prepare(
          'INSERT INTO dj_workspace (id, config_json, seed, result_json, from_draft_json, updated_at) VALUES (1, ?, ?, ?, ?, ?)',
        ).run(ws.config_json, ws.seed, ws.result_json, ws.from_draft_json, ws.updated_at);
        djWorkspace = 'restored';
      }
    }
  })();

  return { counts, library: { replaced: importLibrary, rows: libraryRows }, djWorkspace, autoBackup: displayPath(autoBackup) };
}
