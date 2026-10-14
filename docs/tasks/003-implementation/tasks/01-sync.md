# 01 — Sync + Setup page + SETUP.md/README.md

**Status:** done (step 1)

## Goal

Copy the user's Library from the Spotify Web API into SQLite with an incremental sync job. Give the user a "Setup & Sync" page that leads from "no Spotify app" to "Library synced". Write the first-run guide (`SETUP.md`) and the project overview (`README.md`).

## What was built (files)

| File | Purpose |
|------|---------|
| `packages/shared/src/sync.ts` | `SyncSummary` DTO. |
| `apps/server/src/features/sync/mapping.ts` | Raw Web API types and pure mappers: `playlistKind`, `mapPlaylist`, `mapTrack`, `mapPlaylistEntry`, `mapRecentPlay`, and the `fields` filter for playlist items. |
| `apps/server/src/features/sync/store.ts` | DB writes, one transaction each: playlists (+ removed_at), tracks/artists, playlist items, 403 marker, liked, top, recent plays. |
| `apps/server/src/features/sync/sync.ts` | `runSync(db, client, progress)` and `describeSync()`. |
| `apps/server/src/features/sync/summary.ts` | `syncSummary(db)`. |
| `apps/server/src/features/sync/routes.ts` | `POST /api/sync` (starts job `sync`, returns the Job; 401 if not connected), `GET /api/sync/summary`. |
| `apps/server/src/features/sync/fixtures.ts` | Test fixtures shaped like Web API responses. |
| `apps/server/src/features/sync/{mapping,sync}.test.ts` | 17 tests: mappers, and full syncs against a fake `fetch` with 2-item pages. |
| `apps/web/src/pages/HomePage.tsx` | The page: `?authError=` banner and four steps. |
| `apps/web/src/pages/home/steps.tsx` | `CreateAppStep`, `ConnectStep`, `SyncStep`, `NextSteps`, `useSyncSummary`. |
| `apps/web/src/pages/home/parts.tsx` | `Step`, `LinkButton`, `CopyField`, `Code`, date formatting. |
| `SETUP.md`, `README.md` | First-run guide and overview. |

## Decisions

| Decision | Reason |
|----------|--------|
| `kind`: owner `spotify` → generated; owner = `/me` id → owned; else followed. `items_readable` = owned or collaborative. | As specified. Development Mode returns items only for owned/collaborative playlists. |
| Removed playlists: every listed playlist gets `synced_at = <this sync>`; afterwards `removed_at` is set on rows with another `synced_at`. Listing again clears `removed_at`. | One statement, no id list. Runs only after the full listing succeeded, so a failed listing never marks playlists removed. |
| Items of removed playlists are kept. | Prune/Backup may still need them; `libraryTrackIds` already excludes removed playlists. |
| On 403 for `/items`: delete the playlist's items, set `items_readable = 0` and `items_snapshot_id = snapshot_id`. The upsert keeps `items_readable = 0` while the snapshot is unchanged. | No repeated 403 calls on every sync, and an automatic retry once the playlist changes. Other errors fail the job; finished playlists are already committed, so a rerun resumes. |
| `playlist_items.position` is the entry's index in Spotify, with gaps where local files, episodes or null items were skipped. | Keeps a direct mapping to Spotify positions for later reorder/remove calls. Order is unchanged. |
| The `fields` filter asks for both `item(...)` and the deprecated `track(...)`. | If Spotify drops one of the two names, sync still gets tracks. The track sub-fields are trimmed, so the payload stays small. |
| Top tracks/artists: one request per range (`limit=50`), ranks are **1-based**. | The API max is 50. 1-based ranks read naturally in the Snapshot (`top.s = 1`). |
| Track upsert uses `COALESCE` for `isrc`, `album_id` and `release_date`. Artist upsert changes only `name`. | A response without these fields never erases known values. `genres_json` belongs to enrich. |
| Top artists' `genres` are not stored. | Enrich owns `genres_json`; Spotify marks `genres` deprecated. |
| `GET /me` is called at the start of each sync. | The user id decides `owned`; the auth row could belong to an earlier login. |
| Progress: 10 fixed steps + 1 per changed playlist; messages name the playlist. Liked Songs and the playlist list report counts every 50. | Gives a moving bar on the first, long sync. |
| `POST /api/sync` throws `NotConnectedError` (→ 401) before it starts a job. | The user sees "log in" at once, not a failed job. |
| Summary adds `itemsSynced` and `lastSuccessAt`. | The page uses `lastSuccessAt` to unlock "Next steps" even when the newest job failed. |
| The page reads `authError` from `location.search`. | The auth callback redirects to `/?authError=…`, before the hash. Dismiss removes it with `history.replaceState`. |
| The page follows a sync that is already running (`useLatestJob('sync')`). | A reload during a sync keeps showing progress. |

## How to test manually

1. Without `SPOTIFY_CLIENT_ID`: open <http://127.0.0.1:5173>. Step 1 is "To do" and open; steps 2–4 are "Waiting".
2. Set the Client ID, restart. Step 1 is "Done" (collapsed); the redirect URI copy button works.
3. Open `/?authError=access_denied#/home`: the red banner shows; "Dismiss" removes it from the URL.
4. Connect: step 2 shows your name, id and the "log in again by" date. "Log out" returns to the Connect button.
5. Sync: the bar moves with playlist names; the final message counts playlists, liked songs and new recent plays. The stats grid fills; step 4 unlocks.
6. Sync again: the job finishes fast and says "N unchanged". Recent plays grow only with new plays.
7. Unfollow a playlist in Spotify and sync: "No longer in Library" increases by one.
8. `curl -X POST http://127.0.0.1:8787/api/sync` while logged out returns 401 with `code: not_connected`.

## Known gaps

- Sync does not detect a different Spotify account than the previous one; a switch mixes data. Reset `data/` first (see SETUP.md).
- A non-403 error on one playlist fails the whole job (the finished playlists stay saved).
- Liked Songs are fetched in full on every sync (about one request per 50 songs). There is no cheap change check for `/me/tracks`.
- No route test for `routes.ts` (it uses the process-wide DB); the logic it calls is tested.
- Not tested against the live API yet: the `fields` syntax with `item(...)` and the 403 behaviour for collaborative playlists.

## Parking lot

- Incremental Liked Songs: stop paging when `added_at` reaches the newest known entry and the total is unchanged.
- Store `genres` from top artists when `genres_json` is NULL (free data for enrich).
- Automatic sync on page open when the last sync is older than N hours, to collect more recent plays.
- Record per-playlist 403s in the summary so the UI can list them.
