---
name: propose-playlists
description: Read the user's Spotify Snapshot (data/snapshot.json) and write new playlist Proposals to data/proposals.json for review in the Spotify Curator app. Use when the user asks to propose playlists, for new playlist ideas, or for Proposals.
---

# Propose playlists

You are the curator for this Spotify Curator project. Read the user's **Snapshot** (`data/snapshot.json`) and write **Proposals** (new playlists) to `data/proposals.json`. The web app shows them at `#/proposals`, where the user approves, edits or drops each one and creates the approved ones on Spotify. You never call Spotify yourself. See `docs/adr/0003-agent-neutral-proposals.md` and the glossary in `CONTEXT.md`.

If the user gave a focus for this run (for example "more running playlists" or "only 90s"), respect it in every step.

## Tools you can use

- `apps/server/src/features/proposals/scripts/digest.ts`: a short summary of the Snapshot (step 1).
- `apps/server/src/features/proposals/scripts/tracks.ts`: lists tracks with filters, one compact line per track (step 2).
- `npm run validate-proposals`: checks `data/proposals.json` (step 6).

Run the scripts with `npx tsx <path>` from the repository root. They only read files, so they are safe to run while the app runs.

## 1. Check the Snapshot

Run the digest. It also checks freshness:

```sh
npx tsx apps/server/src/features/proposals/scripts/digest.ts
```

- If it says `No Snapshot`, stop. Tell the user: start the app (`npm run dev`), open http://127.0.0.1:5173, then **Setup & Sync → Sync**, then **Library → Enrich → Build snapshot**, then ask you to propose playlists again.
- If it says `FRESHNESS: STALE`, tell the user why and ask if they want to rebuild the Snapshot first. Continue only if they say so, or if they already asked you to go ahead.
- Note `coverage`. If few tracks have features (BPM/energy), lean on tags, years and artists. If there is no Streaming History, "not played" can only mean "not in the top-tracks lists".

## 2. Read the Library efficiently

The Snapshot can be thousands of lines. **Do not read `data/snapshot.json` whole.** Use the digest (step 1) to see the shape of the Library: Owned Playlists, top artists, tag counts, decade / BPM / energy / valence histograms, liked-by-year, per-tag clusters (count, median BPM and energy, main decade, top artists), the rediscover pool, and the state of earlier Proposals.

Then list candidate tracks per idea with the track lister (one compact line per track):

```sh
S=apps/server/src/features/proposals/scripts/tracks.ts
npx tsx $S --help                                        # all filters
npx tsx $S --tag "trip hop,downtempo" --energy -0.55 --sort energy
npx tsx $S --tag house --bpm 118-128 --sort bpm --limit 150
npx tsx $S --year 1990-1999 --tag "hip hop" --count
npx tsx $S --liked-before 2023-01-01 --no-top --plays 0-0 --sort liked   # rediscover
npx tsx $S --playlist <ownedPlaylistId> --limit 50          # what an Owned Playlist holds
```

Row format: `id | artists — name | year | bpm camelot | e(nergy)/v(alence)/d(ance) | tags | liked YYYY-MM | top s/m/l | p<plays12m> last <date>`.

For anything the scripts do not cover, and if `jq` is installed, use `jq` on `data/snapshot.json` (keys are in `packages/shared/src/snapshot.ts`), for example:
`jq -r '.tracks[] | select(.artists | index("Bonobo")) | .id + " " + .name' data/snapshot.json`.

## 3. Design 6–15 playlists

Make each Proposal reflect the user's **real listening**, not a generic genre list. Mix these themes (the `theme` field):

- `genre` — a scene or genre cluster that the tag clusters show clearly (for example "UK garage and 2-step").
- `mood` — energy and valence: calm, dark, euphoric, melancholic.
- `era` — a decade or a period that is strong in the decade histogram.
- `activity` — focus, running, cooking, late night; derive it from energy, BPM, instrumentalness and acousticness.
- `tempo` — a tight BPM band, ordered by BPM (useful when BPM coverage is good).
- `rediscover` — liked long ago, not played in the last 12 months, not in the recent top lists.
- `other` — anything else that is clearly there (an artist family, a label sound, a language).

Rules:

- **Avoid near-duplicates of Owned Playlists.** Check each idea against the Owned Playlists in the digest (`--playlist <id>` shows their tracks). If more than about half of a Proposal's tracks are already in one Owned Playlist, change the idea or say so in the `rationale`.
- Avoid near-duplicates of each other: one track may appear in more than one Proposal, but no two Proposals should share more than about a third of their tracks.
- Earlier Proposals (listed at the end of the digest): **keep the same `id`** for an idea you keep, so the user's edits and status survive. Do not propose again ideas with status `created` (they are on Spotify) or `dropped` (the user said no), unless the new idea is clearly different; then give it a new `id`.
- **Basic Proposals.** The app can also build simple Proposals by rules (tags, tempo, era), without an Agent: the "Generate basic proposals" button on the Proposals page; their generator is `basic`. They are the fallback for users without an Agent. Your Proposals should go deeper than them. If earlier Proposals are Basic Proposals, you may replace them with better ideas on the same theme.
- If the user gave a focus, respect it.

## 4. Pick and order the tracks

- 15–150 tracks per Proposal. 25–60 is the sweet spot.
- Use **only track ids that appear in the Snapshot**. Copy ids exactly from the lister output. Never invent ids.
- No duplicate ids within one Proposal.
- Give a short `reason` for each pick when it adds information (for example `"liked 2019, 0 plays in 12 months"`, `"124 BPM, 8A"`, `"Massive Attack side project"`). Keep reasons under about 80 characters.
- Order the tracks so the playlist plays well: a gentle energy arc for moods, rising or steady BPM for tempo and activity lists, roughly chronological for eras, and no two tracks by the same artist back to back when you can avoid it.

## 5. Write `data/proposals.json`

The schema is `ProposalsFileSchema` in `packages/shared/src/proposals.ts` (zod). Unknown keys are errors. Read that file if the example below and the schema disagree: the schema wins.

```jsonc
{
  "version": 1,
  "generatedAt": "2026-10-13T18:40:00Z",            // now, ISO 8601 (for example `date -u +%FT%TZ`)
  "snapshotGeneratedAt": "2026-10-13T18:05:12Z",    // copy .generatedAt from data/snapshot.json
  "summary": "2–4 sentences about the Library: the main clusters you saw and how listening changed over time.",
  "proposals": [
    {
      "id": "late-night-downtempo",                // lowercase slug, stable across runs, unique
      "name": "After Hours Downtempo",             // ≤ 100 characters
      "description": "Trip-hop and slow electronics for the last hour of the night.", // ≤ 280 recommended (300 max; the app appends " · by Spotify Curator")
      "theme": "mood",                             // genre | mood | era | activity | tempo | rediscover | other
      "rationale": "Why this fits the user's listening: the evidence (counts, top artists, plays, liked dates).",
      "rules": { "tags": ["trip hop", "downtempo"], "bpm": [70, 110], "years": [1994, 2020], "energy": [0, 0.55], "note": "optional" }, // optional, informational only
      "tracks": [ { "id": "4a8pP5X2lxwU5aprY44jLV", "reason": "Massive Attack, energy .36" } ],          // ordered, 15–150
      "confidence": 0.8                            // 0–1: how sure you are the user will want it
    }
  ]
}
```

Naming guidelines:

- Evocative but clear: the user should know what plays from the name alone. Good: "Sunday Morning Jazz-Funk", "Peak-Time 124–128", "Golden Era Boom Bap", "Rediscover: 2019 Likes". Bad: "Vibes", "Mix 3", "Electronic".
- Use the user's own words when their playlist names show a style (casing, language, punctuation). **No emoji** unless the user's own Owned Playlist names use them.
- The description says what it is in one or two plain sentences. Put the evidence in `rationale`, not in the description.
- `confidence`: high (≥ 0.8) for big, clear clusters with good data; lower for thin data or guesses.

Write only `data/proposals.json`. Change no other file.

## 6. Validate and fix

```sh
npm run validate-proposals
```

It checks the schema, unique ids, unknown track ids (against the local DB), duplicates inside a Proposal, track counts and length limits. It exits non-zero on errors. Fix every error and run it again until it passes. Read the warnings too (overlaps with Owned Playlists or between Proposals, a stale Snapshot) and fix them when it makes sense.

## 7. Hand over

Tell the user, briefly:

- the Library summary in one or two sentences,
- the list of Proposals (name, track count, theme),
- anything you were unsure about,
- next step: open **http://127.0.0.1:5173/#/proposals** (start the app with `npm run dev` if it is not running), review, approve, and press **Create approved playlists on Spotify**.
