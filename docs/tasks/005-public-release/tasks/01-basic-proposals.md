# 01 — Basic Proposals and agent-neutral wording on the Proposals page

## Goal

People without an AI agent can still get Proposals. A "Generate basic proposals" button builds 6–12 **Basic Proposals** by rules (tags, tempo, era, energy, old likes). They go through the same review flow as Agent-written Proposals. The Proposals page no longer names one vendor. It says "your AI agent".

## What changed (files)

| File | Change |
|------|--------|
| `apps/server/src/features/proposals/basic.ts` | New. `buildBasicProposals(db, now)` (DB → Snapshot data → file), `basicProposalsFromSnapshot` (pure core), `writeBasicProposals` (409 unless `replace`), helpers `tagClusters`, `tempoBands`, `spreadArtists`, `titleCase`, `slug`. |
| `apps/server/src/features/proposals/basic.test.ts` | New. 22 tests: helpers, sample fixture, a synthetic fake Library (fake ids and names), 150 cap, no-history Rediscover, route 200/409/replace/400, old files stay valid. |
| `apps/server/src/features/proposals/routes.ts` | Now `makeProposalsRoutes({ db, paths })` (for tests). `proposalsRoutes` is still exported. New `POST /api/proposals/basic`. `ProposalError.code` goes to the client as `code`. |
| `apps/server/src/features/proposals/service.ts` | `ProposalError` takes an optional `code`. The GET response has `file.generator`. |
| `apps/server/src/features/proposals/{validate-cli.ts, scripts/digest.ts, service.test.ts}` | Agent-neutral wording only. |
| `packages/shared/src/proposals.ts` | Additive: optional `generator: 'agent' \| 'basic'` in the file schema, `PROPOSAL_GENERATORS`, `BASIC_PROPOSAL_ID_PREFIX`, `BasicProposalsRequestSchema`, `BasicProposalsResponse`, `PROPOSALS_FILE_EXISTS`, `ProposalsResponse.file.generator`. Comments no longer name a vendor. |
| `apps/web/src/pages/ProposalsPage.tsx` | Agent-neutral intro. Passes `basic` to each card. |
| `apps/web/src/pages/proposals/BasicProposals.tsx` | New. The Generate and Regenerate button with a confirm dialog for replacing the file. |
| `apps/web/src/pages/proposals/Panels.tsx` | The empty state shows two paths side by side: "Use your AI agent" and "Generate basic proposals". The invalid-file panel can replace the file with basic proposals. The summary card has a "Basic" badge and a "Regenerate basic proposals" action. |
| `apps/web/src/pages/proposals/{ProposalCard.tsx, data.ts}` | A "Basic" badge, agent-neutral tooltips, and the `useGenerateBasic` hook. |

## Decisions (with why)

- **Built from Snapshot data, not from `snapshot.json`.** `buildSnapshot(db, now)` gives tags, BPM, Camelot, energy, likes, top ranks and plays in one shape. The core is a pure function of that data, so it is easy to test. The button works without a Snapshot file. The written `snapshotGeneratedAt` is the current Snapshot's time when one exists, so the page does not show a staleness warning.
- **Overlap rule: shared tracks ≤ ⅓ of the smaller list.** This is stricter than the validator's 50% warning. Lists are filled with unused tracks first, then shared tracks within the budget. The biggest size that fits wins. A near-duplicate genre (for example "garage rock revival" next to "indie rock") cannot reach 15 tracks, so it is dropped.
- **Order of selection.** Up to 4 genre clusters come first, then up to 2 tempo bands (from 4 dense windows, because the densest window often repeats a genre), then the mood pair and the era list. More genres follow (up to 8 genres in all). Rediscover goes last, in a reserved slot. Broad filters cut across genres, so they take what is left. Broad tags (electronic, pop, rock, …) are used only when fewer than 6 lists were made.
- **Merging tags.** Tags are normalised (case, `-`/`_`). A tag takes in its sub-genres when it ends their words ("east coast hip hop" → "hip hop"). Broad tags never take in sub-genres, so "indie rock" stays separate from "rock". A cluster is named after a sub-genre that covers ≥80% of it ("house" → "Deep House"). Decades, years and non-genre tags ("seen live", nationalities) are ignored.
- **Names.** A decade prefix is added when ≥60% of a cluster is from one decade ("1990s Hip Hop"). A BPM suffix is added when the p10–p90 span is ≤8 BPM ("Deep House 120–125"). Tempo bands look like "Club Tempo 118–126 BPM". The other lists are "Calm Evenings", "High Energy", "Back to the 1990s" and "Rediscover Old Likes".
- **Thresholds.** Tempo and mood lists need ≥30 tracks with the value and ≥40% coverage. Calm means energy ≤ 0.4. Energetic means energy ≥ 0.75 and danceability ≥ 0.6 where known. A decade "stands out" with a ≥35% share, or with ≥25% and 1.5× the next decade. Rediscover means liked > 2 years ago, not in any top list, and no plays in 12 months when there is Streaming History.
- **Confidence ≤ 0.6** (genre 0.35 + size/400, tempo and era 0.4, mood 0.45, Rediscover 0.5). Rules can only guess.
- **Ids are deterministic** (`basic-<slug>`). A regenerate keeps the user's decisions for the same ids. This is the existing `proposal_state` behaviour.
- **409 for an existing file** of any kind, with `code: "proposals-file-exists"`. The UI then asks before it sends `replace: true`. An empty or too small Library gives a 400.
- **Supported agents are named once**, as a small hint under "Ask your AI agent", because the task asks for it. All other UI text says "your AI agent".

## How to verify

1. `npx vitest run apps/server/src/features/proposals` and `npm run typecheck`.
2. Start the app with a throwaway data folder: `CURATOR_DATA_DIR=<tmp> PORT=<free port>`. Seed it with `seedSampleLibrary` or demo mode. On Proposals, the empty state shows two columns. Press **Generate basic proposals**: 8 lists appear with "Basic" badges. Press **Regenerate basic proposals**: a confirm dialog appears, and Replace rewrites the file.
3. `curl -XPOST localhost:<port>/api/proposals/basic -d '{}'` when a file exists gives 409. `-d '{"replace":true}'` gives 200.

## Parking lot

- A regenerate keeps state by id. If a Basic Proposal with the same id was already created on Spotify, the new version shows as "created" and cannot be created again. This is the same as for Agent files. A future option: add a short hash of the track list to Basic ids.
- Large genre clusters are cut at 150 tracks by tag relevance and affinity. Sub-splitting them (by decade or tempo) would give more lists.
- The `/propose-playlists` skill (workstream 3) could mention the optional `generator` field. Agents should leave it out or set `"agent"`.
- Tempo bands ignore half-time and double-time BPM.
