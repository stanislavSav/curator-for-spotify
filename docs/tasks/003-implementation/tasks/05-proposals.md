# 05 — Proposals: schema, review, apply, `/propose-playlists`

## Goal

Claude Code reads the Snapshot and writes Proposals to `data/proposals.json` (ADR 0001). The app validates the file, lets the user approve, edit or drop each Proposal, and creates the approved ones as private playlists on Spotify.

## What was built (files)

| File | Purpose |
|------|---------|
| `packages/shared/src/proposals.ts` | zod schema `ProposalsFileSchema` (file v1), limits, `validateProposals` (pure), `checkProposalContent`, `overlapShare`, `descriptionForSpotify`, API types (`ProposalsResponse`, `ProposalView`, `ProposalPatchSchema`, `ApplyProposalsSchema`). |
| `apps/server/src/features/proposals/service.ts` | Reads the file and Snapshot, merges `proposal_state`, resolves tracks with `getLibraryTracks`, computes stats and overlap with Owned Playlists, `patchProposal`, `applyProposals`. |
| `apps/server/src/features/proposals/routes.ts` | `GET /api/proposals`, `PATCH /api/proposals/:id`, `POST /api/proposals/apply` (job `apply-proposals`). |
| `apps/server/src/features/proposals/validate-cli.ts` | `npm run validate-proposals [-- path]`. Prints a per-Proposal status, warnings and errors. Exit code 1 on errors. |
| `apps/server/src/features/proposals/scripts/digest.ts` | Compact Snapshot digest for Claude: freshness, coverage, Owned Playlists, top artists, tag counts, histograms (decade, BPM, energy, valence, liked-by-year, plays), per-tag clusters, rediscover pool, state of earlier Proposals. |
| `apps/server/src/features/proposals/scripts/tracks.ts` | Filtered one-line track lister (tags, BPM, energy, years, liked dates, plays, top, playlist, sort, limit). `--help` lists all filters. |
| `apps/server/src/features/proposals/scripts/load-sample.ts` | For UI work: copies the sample to `data/proposals.json` and adds the sample tracks to the `tracks` table. |
| `apps/server/src/features/proposals/fixtures/` | `proposals.sample.json` (8 Proposals), `library.sample.json` (116 tracks, real song names, fake ids), `seed.ts`. |
| `apps/server/src/features/proposals/*.test.ts` | Validator, state merge across a regenerated file, PATCH rules, apply job with a fake `fetch`. |
| `.claude/commands/propose-playlists.md` | The slash command: check Snapshot → digest → list tracks → design 6–15 Proposals → write file → validate → hand over. |
| `apps/web/src/pages/ProposalsPage.tsx`, `apps/web/src/pages/proposals/*` | Review page: empty state, invalid-file panel, summary card, filter tabs, Proposal cards, sticky create bar. |

## Decisions

- **The zod schema checks the shape only; `validateProposals` checks the limits.** A track count or name length error then marks one Proposal, not the whole file. Only broken JSON, a wrong shape or duplicate Proposal ids make the file `invalid`.
- **Unknown track ids are errors for the CLI but do not hide the Proposal in the app.** Claude must fix them; the UI marks them red and the apply job skips them.
- **The validator is pure and gets a context** (`isKnownTrack`, current Snapshot date, Owned Playlists). The server builds the context from SQLite; tests pass a Set.
- **State is keyed by Proposal id and never deleted.** A new file keeps the state of ids that still exist, and an id that comes back later gets its old state. The slash command tells Claude to keep ids stable and to skip ideas that are `created` or `dropped`.
- **Edits store only the changed fields** (`edited_json`). An edit equal to the original is removed. A track edit also stores a fingerprint of the file's track list; when Claude changes that list later, the card says "Claude changed this track list after you edited it".
- **User edits may go below 15 tracks** (the 15 minimum applies to Claude's file). The PATCH accepts track ids that were in the file's list or are in the DB, with no duplicates, 1–150 tracks.
- **`created` is final.** PATCH returns 409, and the apply job skips it, so a retry never makes a duplicate playlist. A failure in one Proposal does not stop the others; the job fails with a summary, and the created ones keep their state.
- **Description on Spotify** = the description + " · by Spotify Curator", shortened with "…" to fit 300 characters. The validator warns above 280 characters.
- **Overlap** = share of the Proposal's tracks that are already in an Owned Playlist (≥ ⅓ shown, ≥ 50 % shown as a warning). Playlists created from Proposals are excluded, so a created Proposal does not overlap with itself after the next sync.
- **The file is re-read on every GET**, and the page refetches on window focus: the user runs Claude in a terminal and comes back to the tab. The Snapshot date is cached by file mtime.
- **The helper scripts open the DB read-only** and never write, so they are safe while the server runs.

## How to test manually

1. `npx vitest run apps/server/src/features/proposals`.
2. Without Spotify: `npx tsx apps/server/src/features/proposals/scripts/load-sample.ts`, then `npm run dev` and open `http://127.0.0.1:5173/#/proposals`. Edit a name, remove and move tracks, approve, drop, reset, switch filter tabs. Do **not** press Create with the sample: its ids are fake. Delete `data/proposals.json` afterwards.
3. Real run: Sync → Enrich → Build snapshot, then `/propose-playlists` in Claude Code, then `npm run validate-proposals`, then review, approve and press **Create N approved playlists on Spotify**. Check the "Open in Spotify" links and the private playlists in Spotify.
4. Regenerate: run `/propose-playlists` again and check that approved, dropped and created states stay on the same ids.

## Known gaps

- No "add track" in the UI: the user can only remove and reorder. Adding from the Library would need a search box.
- The apply job does not write the new playlists into the local `playlists` table; they appear after the next Sync.
- The digest script was tested on a synthetic Snapshot built from the fixture, not on the real `data/snapshot.json` (the enrich agent was building it at the same time).
- `load-sample.ts` adds sample rows to the real DB's `tracks`, `artists`, `audio_features` and `tags` tables (not to Liked Songs or playlists). They are harmless but stay until removed by hand (`id LIKE 'fixture%'`).

## Parking lot

- "Regenerate this one" button that writes a note for the next `/propose-playlists` run (for example "fewer tracks", "more upbeat").
- Show Proposal-to-Proposal overlap on the cards (it is in the file check only).
- A preview player (30 s previews are gone from the API; would need the Web Playback SDK).
