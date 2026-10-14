# 007 — Transition Colour, richer track data, AI pass, bars fix

**Status:** done (2026-10-14)
**Started:** 2026-10-14
**Inputs:** `tasks/decisions-log.md`, ADR 0004, task 006.

## Contract (main session)

`packages/shared/src/dj.ts`:
- `TransitionBars` 2|4|8, `BAR_OPTIONS`, `toBars()`.
- `TransitionColour` + `TRANSITION_COLOURS`; `DjTransitionPrefs.colour` (default medium); `defaultBars` 4|8.
- `DjSetTrack` gets valence, danceability, instrumentalness, acousticness and tags.
- `DjTransition` gets `barsMayBeHidden` and `ai`.
- `AgentCli`, `AiPassAgents`, `AiPassRequest`, `AiPassResult`.
- `JobKind` 'dj-ai-pass'.

## Workstreams

| # | Workstream | Owner | Task file |
|---|------------|-------|-----------|
| 1 | Server: colour + track-data rules, bars clamp/migration, AI pass runner (CLI detection, prompt, JSON parse, validation, job, endpoints), tests | subagent | `tasks/01-server.md` |
| 2 | Web: Colour control, "✦ AI pass" button (Spotify Auto style), progress and result, AI badges with reset to rules/AI, bars UI (2/4/8, "if offered" note), tests | subagent | `tasks/02-web.md` |
| 3 | Integration, real AI run on demo data, docs, push | main session | `tasks/03-integration.md` |
