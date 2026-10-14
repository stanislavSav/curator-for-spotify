# 001 — Research: what is possible with Spotify today

**Status:** done (2026-10-13)
**Started:** 2026-10-13

## Goal

Before we design anything, find out what the Spotify Web API (and nearby services) actually allow in late 2026 for these four jobs:

1. **Analyse** the user's listening and library.
2. **Define** new playlists from that analysis.
3. **Prune**: find and delete playlists the user no longer opens.
4. **Mix**: build a DJ-style playlist that uses Spotify's new configurable transitions.

## Approach

Five research subagents run in parallel. Each one writes its findings to `tasks/`:

| # | Topic | File |
|---|-------|------|
| 01 | Web API state: limits, deprecations, auth, endpoints | `tasks/01-web-api-state.md` |
| 02 | Spotify Mix / DJ transitions feature and API exposure | `tasks/02-mix-transitions.md` |
| 03 | Signals for "playlist not opened anymore" | `tasks/03-playlist-usage-signals.md` |
| 04 | Audio features (BPM / key / energy / genre) sources | `tasks/04-audio-features-sources.md` |
| 05 | Local app stack and clustering approach | `tasks/05-stack-and-clustering.md` |

## Exit criteria

- Each topic has a verdict: **doable via API**, **doable with a workaround**, or **not doable**.
- Open questions for the user go into the grilling session (task 002).
- Ideas that are out of scope go into `parking-lot.md`.

## Result (2026-10-13)

| Job | Verdict | How |
|-----|---------|-----|
| Analyse | Doable | Liked Songs, Owned Playlists, top items, last 50 plays. Followed Playlists return no tracks in Development Mode. |
| Audio features | Workaround | Spotify blocks them. ReccoBeats (by Spotify ID, no key) as the main source. Deezer `bpm` by ISRC as a fallback, through the server. |
| Tags for grouping | Workaround | MusicBrainz/ListenBrainz tags (no key). Spotify artist genres if they still return data. |
| Define playlists | Doable | Create with `POST /me/playlists`, add with `POST /playlists/{id}/items`. |
| Prune signals | Workaround | No "last opened" field. Infer from Streaming History, `KmPageView.json` (technical log), playlist `added_at`, and recently-played context. |
| Prune action | Doable | `DELETE /me/library?uris=spotify:playlist:…`. Owned playlists can be recovered for 90 days. |
| Mix transitions | Not doable via API | Mix exists only in the Spotify app. We can only set the track order. |

Stack: Vite + React + TS web app, Hono server, SQLite (better-sqlite3), npm workspaces, raw `fetch` (the official TS SDK calls removed endpoints). Redirect URI must use `127.0.0.1`, not `localhost`.
