# 02 — Demo mode

## Goal

`npm run demo` lets anyone try the app without a Spotify app. It shows a fake but believable Library on every page, and nothing is ever sent to Spotify. The README screenshots come from it.

## What changed (files)

New:

- `scripts/demo.mjs` — sets `CURATOR_DEMO=1` and `CURATOR_DATA_DIR=data/demo`, checks that `PORT` / `WEB_PORT` are free, starts the two workspace `dev` scripts, prefixes their output, and stops both on Ctrl+C. `--reset` deletes `data/demo/`.
- `apps/server/src/demo/catalog.ts` — 256 well-known public songs in 10 genres. The 116 tracks of `proposals/fixtures/library.sample.json` come first (same fake ids), plus 140 new ones (70s rock, 90s alternative/Britpop, disco/nu-disco, 2010s pop) with album, year, BPM, key and energy.
- `apps/server/src/demo/seed.ts` — `seedDemo(dir, now)` and `ensureDemoData(dir, now)`. It writes the DB, `snapshot.json` (with the enrich Snapshot writer), `proposals.json` (the sample Proposals), one Backup and a `demo-seed.json` marker.
- `apps/server/src/demo/guard.ts` — `DEMO_MESSAGE`, `DemoModeError`, `assertSpotifyAllowed()`, `isBlockedInDemo()`, `withDemoMode()` (also serves `GET /api/demo`).
- `apps/server/src/demo/guard.test.ts`, `apps/server/src/demo/seed.test.ts`.

Foundation changes (small and additive):

- `apps/server/src/config.ts` — `webPort` (from `WEB_PORT`) and `demo` (from `CURATOR_DEMO=1`). The `redirectUri` and `webOrigin` defaults now follow `PORT` / `WEB_PORT`; with no env they are the same as before.
- `apps/server/src/index.ts` — in demo mode, `ensureDemoData(DATA_DIR)` before start; the fetch handler is wrapped in `withDemoMode`.
- `apps/server/src/spotify/auth.ts` — demo mode: `authStatus()` reports connected as "Demo listener"; `/auth/login` and `/auth/callback` redirect to `/`.
- `apps/server/src/spotify/client.ts` — `send()` calls `assertSpotifyAllowed()` first.
- `apps/web/vite.config.ts` — port from `WEB_PORT`, proxy target from `PORT` (defaults 5173 / 8787).
- `apps/web/src/App.tsx` — a slim amber banner when `GET /api/demo` returns `{ demo: true }`.

## Decisions (with why)

- **`GET /api/demo` instead of a new field on `AuthStatus`.** No change to the shared types, and the web app gets a 404 from an older server. It is served by the fetch wrapper, so it answers in both modes.
- **Two guards.** The fetch wrapper refuses `POST` to sync, enrich, prune, restore, apply proposals, create DJ Set and logout with a 403 and the demo message before any route runs. So nothing local changes either (no Backups, no failed jobs), and the UI shows the message in its existing `ErrorNote`. `SpotifyClient` checks again before every request, as a backstop for any path the list misses.
- **Enrich is blocked as a whole.** Its network phases call ReccoBeats, Deezer, MusicBrainz and Wikidata, not Spotify. With fake ids they would only fail slowly (retries with back-off). Building the Snapshot stays allowed: it is local.
- **`DemoModeError` extends `NotConnectedError`.** Code that already handles "not connected" stays graceful (for example the Spotify genres phase), and `app.onError` returns a 401 with the demo message instead of logging a 500.
- **The server seeds, not the script.** `ensureDemoData` runs at server start in demo mode, so any way of starting demo mode works. It refuses the real `data/` folder and any folder that has a DB but no demo marker. It reseeds when the seed is older than 30 days, because Prune and Enrich judge dates relative to today.
- **Dates relative to `now`, seeded RNG.** The same `now` gives the same data (tested). Liked Songs fall in 2018 to today.
- **The seed makes the sample Proposals true.** The Rediscover tracks are liked in 2018–2019, in no Owned Playlist, and have no plays in the last 12 months. Massive Attack, Bonobo and Boards of Canada are top artists in every range. Two rationale lines were reworded to match the demo data. The file validates with no errors and no warnings.
- **Prune has something in each group.** Five stale Owned Playlists (their Exclusive Tracks were last played at different times, one never in the history), one empty playlist, six that are in use, two Followed Playlists with no evidence, one Generated Playlist (excluded), and one pruned playlist with its Backup.
- **A placeholder `auth` row** (`'demo'` tokens, never used), so "is the user connected?" checks pass and the Snapshot names the user "Demo listener".
- **Port check in `demo.mjs`.** If a port is taken, the script says so and suggests `PORT=8797 WEB_PORT=5183 npm run demo` instead of letting `tsx watch` hang on `EADDRINUSE`.
- **npm through `npm_execpath`** when it is set, so Windows needs no shell for `npm.cmd`. Each child runs in its own process group on POSIX (and `taskkill /T` on Windows), so Ctrl+C stops npm and everything it started.

## How to verify

1. `npm run demo` (or `PORT=8797 WEB_PORT=5183 npm run demo` next to `npm run dev`). The server logs "Demo Library seeded …" the first time.
2. Open the web app. The amber banner shows on every page, and the header says "Demo listener".
3. Setup & Sync: all steps done, 11 / 3 / 1 playlists, 256 tracks. "Sync again" and "Log out" show "Demo mode: Spotify is not connected. Nothing was changed."
4. Library: coverage near complete, Spotify genres "Unavailable", a few gaps. "Run enrich" shows the demo message. "Build snapshot" works.
5. Proposals: 8 Proposals, one approved. "Create … on Spotify" shows the demo message.
6. Prune: 6 candidates, 2 with no evidence, 6 kept, one Backup. "Prune" and "Restore" show the demo message.
7. DJ Set: build a set from any Pool; "Create on Spotify" shows the demo message.
8. `npm run demo -- --reset` seeds again. `npx vitest run apps/server/src/demo` covers the guard and the seed.

## Parking lot

- The snapshot job message says "Saved to data/snapshot.json." In demo mode the file is `data/demo/snapshot.json` (enrich feature text, not changed here).
- The demo server still loads `.env` (through the server `dev` script). Nothing from it is shown or used in demo mode except `SPOTIFY_REDIRECT_URI` in the status payload.
- Album art: all playlists and tracks have no images. Placeholder covers could make the screenshots nicer.
- No saved DJ Sets in the seed ("Earlier sets" is empty), because a created set needs a Spotify playlist id.
