# 02 — Enrich + Snapshot + Library page

**Status:** done (step 1)
**Owner files:** `apps/server/src/features/enrich/**`, `apps/web/src/pages/LibraryPage.tsx`, `apps/web/src/pages/library/**`, `packages/shared/src/library.ts`
**Inputs:** research `001-research/tasks/04-audio-features-sources.md`, `01-web-api-state.md` (artist `genres` status).

## Goal

Add BPM, key, energy and genre tags to the Library. Write the Snapshot (`data/snapshot.json`) that Claude reads to write Proposals. Show coverage and a searchable track table on the Library page.

## What was built (files)

Server, `apps/server/src/features/enrich/`:

| File | Purpose |
|------|---------|
| `enrich.ts` | `runEnrich(db, deps, progress)`: the enrich job with four phases (ReccoBeats → Deezer → Spotify genres → MusicBrainz). Limits in `DEFAULT_LIMITS`. |
| `reccobeats.ts` | `parseReccoBeats` / `fetchReccoBeats`: ≤40 ids per call, maps items back by the Spotify id in `href`, then by ISRC. |
| `deezer.ts` | `parseDeezer` / `fetchDeezerBpm`: handles the HTTP 200 + `error` object (800 = unknown, 4 = quota). |
| `musicbrainz.ts` | ISRC lookup (`/isrc/{isrc}?inc=artist-credits+tags`), name-search fallback, credit matching, tag weights. |
| `http.ts` | `getJson` (429/503 backoff with Retry-After, 404 → null) and `Throttle` (minimum gap between calls). |
| `store.ts` | `enrich_attempts` helpers (30-day retry), tag replace, `libraryArtists`, tag/name normalisation. |
| `snapshot.ts` | `buildSnapshot(db, now)`, `serializeSnapshot` (one line per track), `writeSnapshot`, `historyByUri`. |
| `library-view.ts` | Cached Library rows, `queryLibrary` (search/sort/filter/page), `coverage`. |
| `routes.ts` | `POST /api/enrich` (job `enrich`), `POST /api/enrich/snapshot` (job `snapshot`), `GET /api/enrich/coverage`, `GET /api/enrich/tracks`. |
| `snapshot-cli.ts` | `npm run snapshot`: writes the Snapshot from the terminal and prints a summary. |
| `*.test.ts`, `test-fixtures.ts` | 24 tests: parsers, incremental runs, 30-day retry, batching, genre probe, source outage, MusicBrainz cap, Snapshot contract, JSON layout, table query, coverage. |

Shared: `packages/shared/src/library.ts` — `EnrichCoverage`, `LibraryTracksQuery`, `LibraryTrackRow`, `LibraryTracksPage`, `LibrarySort`, `LibraryMissing`.

Web: `LibraryPage.tsx`, `library/CoveragePanel.tsx` (stats, Enrich and Build snapshot cards with `JobProgress`), `library/TrackTable.tsx` (server-side table), `library/useJobRunner.ts`.

### API

- `GET /api/enrich/tracks?q=&sort=&dir=&offset=&limit=&missing=`
  - `sort`: `name | artist | bpm | key | energy | liked | plays` (default `artist`). Empty values sort last in both directions.
  - `missing`: `features | bpm | tags`. `limit` 1–200 (default 50).
  - `q`: every word must appear in title, album, artists or tags.

## Decisions

| Decision | Reason |
|----------|--------|
| Each phase skips entities that already have data or an attempt in the last 30 days (`enrich_attempts`). Successful lookups also write an attempt row. | Makes the job resumable and incremental. A second run with nothing new makes zero requests (tested). |
| ReccoBeats overwrites a Deezer-only row on a later retry, but never a `manual` row. Tempo uses `COALESCE`. | ReccoBeats has the full feature set. Manual values are the user's choice. |
| Deezer updates only `tempo`, and only when it is NULL. The row's `source` stays as it was, except a new row gets `deezer`. | One `source` column per row. A ReccoBeats row with a Deezer tempo is still mostly ReccoBeats data. |
| Spotify genre "stripped" state is a marker row in `enrich_attempts` (`entity_type 'meta'`, id `spotify-genres-stripped`). It expires after 30 days. | No schema change. Later runs do not spend 20 more calls to learn the same thing. |
| MusicBrainz: ISRC → recording with `inc=artist-credits+tags`, one request per artist. Name search only when the ISRC gives no match. | I checked live: this response already contains the artist tags with counts. One request instead of two, and no namesake risk. |
| MusicBrainz track pick: a track where the artist is the only credit first. A solo track with one credit matches even when the names differ. | Handles transliterated names (for example Cyrillic) without guessing on multi-artist tracks. |
| Featured artists on the same recording are tagged from the same response. | Free extra coverage at 1 req/s. |
| MusicBrainz limits: 400 artists per run, 6-minute budget, 1.1 s gap. Deezer: 1000 tracks per run, 120 ms gap. Spotify genres: 1000 artists per run. | Keeps each run bounded. The job says how many are left for the next run. |
| Tag weight = count / max count, top 10 per artist. Tags are lowercased, a few synonyms merged (`hip-hop` → `hip hop`, `rnb` → `r&b`), noise and plain years dropped. Decades (`80s`, `2010s`) are kept. | Decades help themed Proposals. |
| A failure in one source does not stop the job. The summary says which phase failed. | ReccoBeats has no SLA. Deezer and MusicBrainz should still run. |
| Snapshot `lastPlayed` = last play ≥30 s at any time (not only 12 months). `withHistory` = tracks with a `lastPlayed`. | More useful to Claude. `plays12m` stays strictly 12 months. |
| Snapshot `liked` and `lastPlayed` are dates (`YYYY-MM-DD`). Playlist `desc` is cut at 200 characters. | Smaller file. |
| Snapshot track order: liked newest first, then by first artist and title. | Stable order for reading in line ranges. |
| `tagCounts` counts the tags as written in the Snapshot (max 6 per track). | The numbers match what Claude sees in the file. |
| `withFeatures` counts a track with any feature, also a Deezer BPM only. | Same meaning in the Snapshot and on the Library page. |
| Library table works on an in-memory copy, rebuilt when a cheap DB fingerprint changes or after 60 s. | 5–10k tracks page and sort fast without re-running the full join per request. |

## How to test manually

1. Connect and Sync on the Setup page.
2. Open **Library**. The cards show 0% with BPM and tags.
3. Click **Enrich**. The progress line names the phase ("ReccoBeats: audio features 120/800 tracks", then Deezer, Spotify, MusicBrainz). Coverage refreshes every 5 s.
4. When it finishes, read the summary line. If Spotify genres are stripped, an amber note appears.
5. Click **Enrich** again. It should finish at once with "nothing new" for each phase (except leftovers from per-run caps).
6. Click **Build snapshot**. Check `data/snapshot.json`: pretty top level, one line per track.
7. Or run `npm run snapshot` in a terminal.
8. In the table: search "house", sort by BPM, choose "Missing features", page with Next.

## Known gaps

- Key comes only from ReccoBeats. Tracks that ReccoBeats does not know have BPM (Deezer) but no key or energy. Essentia.js analysis of Deezer previews is not built.
- Last.fm (mood tags) and Discogs (styles) are not used. Last.fm needs a key.
- No track-level tags. MusicBrainz recording tags are in the same response, but storing them for one track per artist would give uneven coverage.
- A first run on a large Library can take 15–20 minutes (Deezer and MusicBrainz caps). Later runs continue where it stopped.
- The enrich job cannot be cancelled. A server restart marks it failed; the next run resumes.
- The Snapshot does not use `recent_plays` for `lastPlayed`. Only Streaming History counts.
- The Library page does not let the user edit BPM or key yet (`manual` source is supported in the DB).

## Parking lot

- "Manual override" for BPM/key in the table.
- Essentia.js key/BPM from the Deezer 30 s preview for tracks ReccoBeats misses.
- Last.fm tags if the user adds a key.
- A "Cancel" button for long jobs (needs a cancel hook in `jobs.ts`).
- Show per-source attempt counts (tried / not found) on the Library page.
