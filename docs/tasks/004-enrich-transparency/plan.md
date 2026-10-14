# 004 — Enrich: finish in one run, and show what is going on

**Status:** done (2026-10-14)
**Trigger:** Enrich seemed to make no progress and had to be run again and again. The user asked for more transparency.

## Diagnosis (from a real Library)

- Enrich *was* progressing. ReccoBeats and Deezer finished in run 1: most tracks got features, and Deezer added BPM for a small part of the rest.
- MusicBrainz (artist tags, 1 request/s) was capped at 6 minutes and 400 artists per run. With a few thousand artists, and about 40 % needing a second request (name search), each run did only about half of its cap. That meant many manual runs.
- The progress bar showed `x/400`, the per-run cap, not the real remaining work. The "time limit reached, run again" note was only in the final job message.
- Job polling paused while the browser tab was in the background (React Query default), so the numbers could look frozen.

## Changes

1. One run finishes everything: no per-run caps by default. **Stop** button: `POST /api/jobs/:id/cancel` uses an AbortSignal in `JobContext`. The job finishes the current request and ends; the next run continues.
2. Progress line: `Step 4/4 · MusicBrainz … · <done>/<total> artists · ~<minutes> min left`.
3. New `GET /api/enrich/status`: per source, found / not found / skipped (with the reason) / waiting, the retry date for not-found items, and an ETA. It also explains the gaps (no BPM / no key / no tags, and why), and lists past runs.
4. A new Enrich panel on the Library page: an overall "% looked up" bar, a source table with segmented bars, "What is still missing", and the past runs.
5. Job polling keeps running in background tabs.
6. Tracks that are no longer on Spotify (empty name, 0 duration) are labelled in the table.
7. The message for a job cut off by a server restart now says to run it again to continue.

## Files

`jobs/jobs.ts` (cancel, history), `features/enrich/{enrich,status,routes,library-view}.ts`, `status.test.ts`, `shared/library.ts` (`EnrichStatus`), `web/src/api.ts`, `pages/library/{EnrichPanel,CoveragePanel,useJobRunner}.tsx|ts`.

## Verification

- 155 tests pass and the typecheck is clean.
- Live check in Chrome on a real Library: Continue → progress ticks every ~1.5 s → Stop ended the job in about 9 s → Continue picked up where it stopped.

## Round 2 — speed (2026-10-14)

**Trigger:** the user asked for a faster Enrich, because the MusicBrainz queries took a long time.

The MusicBrainz limit is 1 request/s, so the fix is fewer requests. Tested live first:

| Approach | Live result |
|----------|-------------|
| MusicBrainz `/url?resource=…` with 100 Spotify artist URLs per request | About 70 % of a 100-artist sample of untagged artists matched by exact Spotify link (0.26 s) |
| MusicBrainz search `arid:(id1 OR … id100)` | Tags for 100 artists in one request |
| Wikidata SPARQL, Spotify artist id (P1902) → genre (P136), 150–200 ids per query | About 10 % of a 200-artist sample of the remaining niche artists (~1 s) |

New enrich order: 1 ReccoBeats → 2 Deezer → 3 Spotify genres → **4 MusicBrainz linked (batched)** → **5 Wikidata genres** → 6 MusicBrainz one by one (only artists with no Spotify link).

Result on a real ~3k-track Library (one run, about 2 minutes): the number of MusicBrainz-tagged artists grew more than threefold. Wikidata added genres for several hundred more artists. The number of tracks without tags dropped by about 40 %. The few hundred artists left for step 6 take ~3–8 min, instead of ~60 min before.

Files: `musicbrainz.ts` (`linkSpotifyArtists`, `artistsByMbid`, `parseUrlLookup`), `wikidata.ts` (new), `enrich.ts` (phases d/e), `status.ts` (Wikidata row, new ETA), `musicbrainz-wikidata.test.ts` (new), `enrich.test.ts`. Now 159 tests.
