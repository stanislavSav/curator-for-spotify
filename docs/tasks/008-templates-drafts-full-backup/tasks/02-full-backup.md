# 02 — Full Backup

## Goal

One downloadable file with the user's work (and, optionally, the library cache) that the user can import on another device. The import merges, and the user picks what happens on each conflict.

## What changed

- `packages/shared/src/backup.ts`: the file contract (`FullBackupSchema`, `parseFullBackup`, `fullBackupFileName`) and the import types (`ImportPreview`, `ImportConflict`, `ConflictChoice`, `ImportRequest`, `ImportResult`).
- `apps/server/src/features/backup/service.ts`: `exportFullBackup`, `previewImport`, `applyImport`, `writeAutoBackup`.
- `apps/server/src/features/backup/routes.ts`, mounted at `/api/backup`:
  - `GET /export?library=0|1`: the file, as an attachment named `spotify-curator-backup-YYYY-MM-DD.json`.
  - `POST /import/preview` (body: the file): counts per kind (new, conflicts, unchanged), the conflict list, library row counts, warnings.
  - `POST /import` (body: `{ backup, choices, defaultChoice, importLibrary }`): result counts and the path of the automatic Full Backup.
- `apps/web/src/pages/home/FullBackupCard.tsx`: the "Full Backup" section at the end of Setup & Sync. Download adds the DJ settings from the browser (`dj-config-v1`). Import reads `.json` or `.json.gz`, shows the preview with a choice per conflict, "Apply to all", the library choice and "Restore DJ settings".
- `scripts/lib/check-public-rules.mjs`: blocks `spotify-curator-backup*.json(.gz)` and `*.curator-backup.json(.gz)` anywhere in the tree.

## File format

```
{ format: 'spotify-curator-backup', version: 1, exportedAt, appVersion, includesLibrary,
  work: { djTemplates, djSets, proposalState, proposalsFile, backups, pruneLog, backupRestores },
  library: { <table>: { columns, rows } } | null,
  client: { djConfig } }
```

Work rows keep their DB column names. `proposalsFile` is the raw text of `proposals.json`. Library tables are stored as columns and rows to keep the file small. Never included: `auth` (tokens) and `jobs`.

## Decisions

- **Matching.** Set Templates by name (case-insensitive); DJ Sets by id; Proposal decisions by Proposal id; Backups by playlist id and `created_at` (the row id differs between devices, so it is not part of the match). Equal content counts as "already here".
- **Choices.** `mine` keeps this device's item; `theirs` overwrites it (a template keeps its local id); `both` imports a copy with a new id and the suffix " (imported)". A copy makes no sense for Proposal decisions and the Proposals file, so `both` keeps mine there and the UI disables it.
- **Logs.** The prune log and Backup restores never conflict. Their `backup_id` is mapped to the local Backup id; a restore whose Backup is not in the file is skipped.
- **Library.** All-or-nothing: the import deletes all 13 library tables and inserts the file's rows in the same transaction. Unknown columns are rejected before any SQL uses them. In the dialog, "Replace" is the default only when this device has no library cache.
- **Atomicity.** All DB changes run in one transaction. Backup files (`backups/`) and `proposals.json` are written at the end of the transaction, so a file error rolls back the DB. `proposals.json` is written through a temp file and a rename.
- **Safety.** Before an import, the server writes a Full Backup (work and library) of the current state to `DATA_DIR/full-backups/auto-before-import-<ts>.json`. An import is refused (409) while a job runs.
- **No gzip on export.** The export is plain JSON. The import accepts `.json.gz` too (the browser unpacks it with `DecompressionStream`), so a user can compress a big file by hand.

## How to verify

- `npx vitest run apps/server/src/features/backup`
- `node --test "scripts/**/*.test.mjs"`
- Demo on side ports: Setup & Sync › Full Backup › Download, change something, Import… the file, pick choices, Import.

## Parking lot

- Gzip the export when the library cache is included (smaller download).
- Add `spotify-curator-backup*` and `*.curator-backup.json` to `.gitignore` as a second guard.
- Stream the import for very large libraries instead of one JSON body.
