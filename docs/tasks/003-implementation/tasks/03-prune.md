# 03 — Prune: Streaming History, Usage Evidence, Backup, Prune, Restore

**Status:** done (step 1, not yet integrated in a running app)
**Date:** 2026-10-13
**Research:** `docs/tasks/001-research/tasks/03-playlist-usage-signals.md`

## Goal

Find playlists that the user no longer uses, show the Usage Evidence for each, and let the user prune the ticked ones after confirmation. Save a Backup before each prune. Let the user restore from a Backup.

## What was built (files)

Server, `apps/server/src/features/prune/`:

| File | Content |
|------|---------|
| `history.ts` | Streaming History import. Unzips the export with fflate, keeps `Streaming_History_Audio_*.json`, `endsong_*.json` and the old `StreamingHistory[_music_]N.json`. Detects the format per row. Matches old-format rows to library tracks by artist + title. `INSERT OR IGNORE` into `stream_history`. `historySummary()`. |
| `evidence.ts` | Pure scoring: `scorePlaylists(input, { months, now })`. Context, Exclusive Track and edit evidence → `lastUsed` → group, `preselect`, reasons, notes. |
| `candidates.ts` | Loads `EvidenceInput` from the DB (`loadEvidenceInput`) and calls the scorer. |
| `prune.ts` | `runPrune` (Backup → `removeFromLibrary` → `prune_log` → `removed_at`), `writeBackup`, `listBackups`, `restoreBackup`. |
| `routes.ts` | The endpoints below. |
| `*.test.ts` | 46 tests: parsing, zip filter, legacy matching, dedupe, summary, scoring rules, prune with a fake Spotify, restore, routes. |

Endpoints (all under `/api/prune`):

| Method | Path | Result |
|--------|------|--------|
| POST | `/history` | multipart, any field name. Small upload → `{ result }`. Large upload → `{ job }` (kind `history-import`). |
| GET | `/history/summary` | `HistorySummary` |
| GET | `/history/import/:jobId` | `HistoryImportResult` of a finished import job |
| GET | `/candidates?months=12` | `PruneCandidatesResponse` (months clamped to 1–120) |
| POST | `/` `{ playlistIds }` | `{ job }` (kind `prune`) |
| GET | `/results/:jobId` | per-playlist `PruneResult[]`, live while the job runs |
| GET | `/backups` | `BackupInfo[]` |
| POST | `/restore/:backupId` | `RestoreResult`; 404 unknown, 409 already restored |

Shared: `packages/shared/src/prune.ts` (DTOs, `PruneRequestSchema`, `RECOVER_PLAYLISTS_URL`, `DEFAULT_PRUNE_MONTHS`, `MIN_PLAY_MS`).

Web: `apps/web/src/pages/PrunePage.tsx` and `apps/web/src/pages/prune/` (`ImportCard`, `CandidateTable`, `PruneDialog`, `BackupsCard`, `format.ts`).

Foundation change (additive): `apps/server/src/db/db.ts` has a new table `backup_restores (backup_id, restored_at, action, playlist_id, url)`.

## Decisions

| Decision | Reason |
|----------|--------|
| Scoring is one pure function with a plain data input. | Easy to test every rule without a DB. The DB loader is a thin separate step. |
| Groups: empty → `candidate`; evidence inside the window → `keep`; old evidence → `candidate`; no evidence → `no-evidence`. | Matches the decisions log. Followed Playlists without context evidence land in `no-evidence`. |
| `preselect` is true only for empty playlists, and for Owned Playlists with old evidence **when Streaming History is imported**. | Without the export, an old edit date says nothing about plays. Pre-ticking such a playlist would invite a wrong delete. The row still shows as a candidate, with a note. |
| Followed Playlists are never pre-ticked, even with old context evidence. | Their only evidence is the last 50 plays. |
| For a playlist the user does not own (collaborative), edits count only when `added_by` is the user. | The owner's edits say nothing about the user's use. |
| Exclusive Track: in exactly one non-removed playlist (any kind with readable items) and not liked. Plays count from 30 s. | Glossary definition and research 3.1. |
| `lastUsed` source ties keep the first source (context, then exclusive, then edit). | Stable output; ties are rare. |
| Timestamps are stored as `YYYY-MM-DDTHH:MM:SSZ`. | String order is time order, so SQL `MIN`/`MAX`/`>=` work. |
| Old-format rows: match normalised artist + title against every artist of every synced track. Rows that do not match are dropped (the table needs a URI). A matched row is skipped when the extended history has the same track within ±1 minute. | No URI in the old format. Avoids double counting when both exports are imported. |
| Upload goes as a job when it is larger than 4 MB (a zip counts as 8× its size). | Small uploads give an instant answer; a full extended export does not block the request. |
| Backup is written before the remove call. If the Backup fails, the playlist is not removed. If the remove fails, the Backup stays and the playlist stays. | Safety rule from the decisions log. |
| Followed Playlists are not read from Spotify before pruning (403 in Dev Mode). Owned: fresh items from `/playlists/{id}/items`, fallback to the DB. | Avoids a known-failing call; fresh order when possible. |
| `prune_log.kind` stores the playlist kind (`owned` / `followed`). | The action (delete / unfollow) follows from it. |
| Restore of an Owned Playlist recreates it with `createPlaylist`; local files are skipped; the description gets "Restored from a Backup of <date>." (max 300 chars). A Backup can be restored once. | As asked. A second restore would create a duplicate playlist. |
| Prune and import job results are kept in memory, keyed by job id. | Only needed while the page watches the job. Backups and `prune_log` are persistent. |
| UI: ticks are stored as user overrides on top of `preselect`. | Moving the months slider keeps the user's own ticks. |

## How to test manually

1. Connect and run Sync on the Setup page.
2. Open **Prune**. With no import, the import card says the export is pending. Candidates show but are not ticked (except empty playlists).
3. Drop the export `.zip` (or some `Streaming_History_Audio_*.json` files) on the import card. Check the counts, the date range and the "In library" percentage.
4. Move the slider (1–36 months). Groups and ticks update; your own ticks stay.
5. Open "No evidence" and "Keep". Check the evidence column and the notes.
6. Tick a test playlist (make a throw-away Owned Playlist first). Click **Prune 1 playlist** → read the dialog → confirm. Watch the progress and the result.
7. Check `data/backups/<date>-<id>-<slug>.json`, and that the playlist is gone in Spotify.
8. In **Backups**, click **Restore**. An Owned Playlist comes back as a new playlist; a Followed Playlist is followed again.

## Known gaps

- Not run against the real Spotify API yet. `DELETE /me/library` for an owned playlist and the 90-day recovery are UNVERIFIED end to end (research 5.3).
- `stream_history` is joined to tracks by URI only. Re-released tracks with a different URI do not count as plays of the playlist copy.
- If Sync later clears `removed_at` for a playlist (for example, the user follows it again in Spotify), the scoring sees it again. That is correct, but the old Backup stays "not restored".
- Job results are lost on a server restart (the Backups list is not).
- A second import or prune started while one runs returns the running job; the new upload or selection is ignored.
- The months slider stops at 36 in the UI (the API accepts up to 120).

## Parking lot

- Restore an Owned Playlist by following its original URI again (`PUT /me/library`), which may bring back the original with its followers. Needs a real test first.
- Use `Playlist1.json` (`lastModifiedDate`) and `SearchQueries.json` from the account-data export as extra evidence.
- Show plays of shared (non-exclusive) tracks as weak evidence, and coverage per playlist.
- Warn when an Owned Playlist has followers (`numberOfFollowers` in the export).
- A "clear history" button and an import log table.
