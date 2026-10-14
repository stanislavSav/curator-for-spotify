# 01 — Server: colour, track data, bars, AI pass

## Goal

Fill the Transition Sheet with more than Volume + EQ (Transition Colour), use more track data, keep bars at 2 / 4 / 8, and run the AI Pass through the user's agent CLI (ADR 0004).

## What changed

- `features/dj/transitions.ts`: five steps: Situation → recipe → Sheet Style → `TRACK_RULES` (vocals, acoustic) → `EXTRAS` (colour). `setPositions()` gives each pair its place in the set. `likelyNoBeatGrid()` sets `barsMayBeHidden`. Bars never go above 8.
- `pool.ts`, `order.ts`: every `DjSetTrack` has valence, danceability, instrumentalness, acousticness and the top 6 tags.
- `schema.ts`, `sets.ts`: stored 16 bars read as 8; old tracks and transitions get the new fields. `aiPassRequestSchema`.
- `ai-pass/`: `agents.ts` (`CLI_COMMANDS`, `detectAgents`, `runAgentCli`), `prompt.ts`, `parse.ts`, `run.ts`.
- Routes: `GET /api/dj/ai-pass/agents`, `POST /api/dj/ai-pass`, `GET /api/dj/ai-pass/:jobId`.

## Decisions

| Question | Answer |
|----------|--------|
| Do track rules apply at Subtle? | Yes. Vocal and acoustic rules are what a pair needs. Subtle adds no colour and ignores position. |
| Unknown instrumentalness | Counts as vocal (unless tagged instrumental), so a crossfade and a 3-band fade replace a long overlap. |
| Colour level | Subtle 0, Medium 1 extra, Bold 2 extras. +1 near the peak, −1 for the first and last transition. The last transition gets "Reverb out end" when the effects slot is free. |
| Variety | FNV-1a hash of the two track ids rotates the list of extras that fit. |
| Peak | The pair's curve target is in the top 20 % of the set's target range. A flat curve has no peak. |
| AGENT_CLI | Wins when the CLI is on PATH; otherwise the preference order claude, codex, gemini. |
| Edited pairs on a saved-set pass | "Untouched" means settings equal the rule suggestion or the previous AI version. Edited pairs keep the user's settings and only get `ai`. |
| Named presets from the AI | Accepted, with all values null (the preset decides). |

## How to verify

- `npx vitest run apps/server/src/features/dj`
- `AI_PASS_LIVE=1 npx vitest run apps/server/src/features/dj/ai-pass/live.test.ts` (real CLI, small set of public songs).
- Demo: `PORT=8797 WEB_PORT=5183 npm run demo`, POST a preview to `/api/dj/ai-pass`, poll `/api/jobs/:id`, then GET `/api/dj/ai-pass/:jobId`.

## Parking lot

- Gemini flags come from its docs only; it was not installed for a live check.
- Codex cannot turn its tools off; it runs with a read-only sandbox in an empty folder.
