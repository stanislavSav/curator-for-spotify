# 06 — Integration (main session)

**Date:** 2026-10-13

## What was checked

- `npm run typecheck`: clean for shared, server and web.
- `npx vitest run`: 17 files, 152 tests, all passing.
- `npm run build`: OK (the web bundle is ~444 kB, ~133 kB gzip).
- Every endpoint was called through the Vite proxy against a throwaway seeded DB (116 sample tracks, 6 playlists, 17 Streaming History rows, sample proposals).
- Each page was clicked through in Chrome with the seeded data: Setup & Sync, Library, Proposals, Prune (2 candidates, 2 with no evidence, 1 keep, 1 Generated Playlist left out), and DJ Set (a 14-track, 1 h set that follows the warm-up → peak → cool-down curve, with a full Transition Sheet). There were no console errors.
- Afterwards the demo data was deleted. The real `data/curator.sqlite` is empty.

## Foundation changes during step 1

- `db.ts`: `backup_restores` table, added by prune.
- `db.ts`: `CURATOR_DATA_DIR` env override for `DATA_DIR`, added by the main session for demo and test runs.

## Not tested yet (needs the user's Spotify app)

- Real PKCE login, sync, `/me/library` delete, playlist creation.
- Whether `DELETE /me/library` on an Owned Playlist shows up in Spotify's 90-day recovery page.
- Whether Spotify artist `genres` still return data in Development Mode.
