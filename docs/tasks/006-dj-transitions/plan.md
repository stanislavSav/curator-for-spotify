# 006 — DJ Set: convenient settings and a Spotify-shaped Transition Sheet

**Status:** done (2026-10-14)
**Started:** 2026-10-14
**Inputs:** `tasks/decisions-log.md`, ADR 0002.

## Contract (done by the main session)

`packages/shared/src/dj.ts`:
- `MIX_PRESETS`; the `VOLUME_` / `EQ_` / `FILTER_` / `EFFECTS_` / `LOOPING_OPTIONS` (exact Spotify labels); `BAR_OPTIONS`; `TransitionSettings`; `SETTING_ROWS` (label, colour, options); `PRESET_VALUES` (empty).
- `SheetStyle` + `SHEET_STYLES`.
- `DjTransition` = { settings, suggested, bpmDeltaPct, keyRelation, energyDelta, reason, applied }.
- `DjTransitionPrefs` = { sheetStyle, defaultBars, rules }.
- `normaliseDjConfig()` for stored or partial configs.
- `DjSetSummary.applied`, `DjTransitionPatch`.

## Workstreams

| # | Workstream | Owner | Task file |
|---|------------|-------|-----------|
| 1 | Server: rule engine producing full TransitionSettings per Sheet Style; migration of stored sets; PATCH edits/applied; tests | subagent | `tasks/01-server.md` |
| 2 | Web: accordion config panel with live preview and remembered config; Spotify-style cards; inline edit; Applied checklist; Apply mode; copy/print | subagent | `tasks/02-web.md` |
| 3 | Integration, demo screenshots, README/SETUP text, publish | main session | `tasks/03-integration.md` |

## Exit criteria

- Every transition shows a preset, bars and five values with Spotify's exact labels (or "preset decides").
- Edits and Applied ticks persist for created sets; a preview's edits travel with Create.
- The left panel needs no scrolling to rebuild; a change rebuilds in under about 1 s.
- Typecheck, tests and `check:public` pass; CI is green.
