# 01 — Server: Transition Settings per Sheet Style, migration, edits

**Status:** done
**Inputs:** `../plan.md`, `decisions-log.md`, ADR 0002, contract in `packages/shared/src/dj.ts`.

## Goal

For each pair in a DJ Set, the server suggests a full Spotify Transition: a Mix Preset, bars and the five Transition Settings, with Spotify's exact option names, shaped by the Sheet Style. Created sets keep the user's edits and Applied ticks. Sets saved in the old shape still open.

## What changed

All in `apps/server/src/features/dj/`. The shared contract was not changed.

- `transitions.ts`: rewritten as three steps.
  1. `classify()` puts the pair into a Situation (first match wins): big clash, soft clash, unknown key (Auto), build, long blend, lift, wind-down, standard, else Auto.
  2. `RECIPES` holds the base settings per Situation (one row each, Balanced style).
  3. `STYLE` transforms them for Smooth & long, Club cuts and Ambient washes. Club turns a big clash into No transition.
  - `namePreset()` names a Mix Preset when a Custom result matches `PRESET_VALUES` exactly (empty for now; the table can be injected in tests).
  - The reason is one sentence: evidence (key move, tempo %, energy) and then the intent, built from the chosen settings (for example "bass swap halfway, both tracks full volume").
  - `TransitionEnd` no longer has `name`. The reason says "this track" / "the next track" instead of a track name.
- `schema.ts`: `transitionSettingsSchema` (zod enums from the shared option lists), the new `DjTransition` shape (`applied` defaults to false), `sheetStyle` in the config, `djTransitionPatchSchema`. Preview and create run `normaliseDjConfig` on the incoming config before validation.
- `sets.ts`: on read, the config goes through `normaliseDjConfig`. Old transitions (no `settings`) get fresh suggestions from the stored tracks, `applied: false`; without tracks, Auto. Summaries have `applied` counts. `patchDjTransition()` updates one transition and stores the normalised result (an old set is migrated on its first edit).
- `routes.ts`: `PATCH /api/dj/sets/:id/transitions/:index` with `DjTransitionPatch` → the updated `DjSetRecord`; 400 for an invalid body, 404 for an unknown set or index. `POST /sets` stores the transitions from the request as they are (edits included).

## Decisions

| Decision | Reason |
|---|---|
| Situation → base recipe table, then a Sheet Style transform. | Easy to read and tune: one row per Situation, one function per style. |
| Smooth & long removes hard cuts: cut volumes become fades, "Quick bass cut" becomes "Long bass cut", "… cut end" effects become "… out end", and a replaced cut gets "Echo ½ out end" when Effects is None. | "Use Echo instead of hard cuts." |
| Ambient washes sets Volume "Smooth crossfade" and EQ "3-band fade" on clashes too; only the bars stay short. | Follows the spec literally; the short bars, filter and echo still mask the clash. Easy to change in `STYLE.ambient`. |
| A clash (or a step over the max) with the clash rule off ends as Auto; lift, wind-down and standard need the tempo step within the max. | Same as the old engine. |
| The API accepts any preset with any mix of null and set values; it only checks that each value is a known option. | The web UI may switch Auto → Custom before the user fills every row. |
| Stored sets are migrated on read, and written back only on the first PATCH. | Reads stay side-effect free; re-deriving is deterministic. |

## How to verify

```sh
npx vitest run apps/server/src/features/dj
npx tsc -p apps/server
```

`transitions.test.ts` covers every Situation × Sheet Style, Auto and No transition shapes, rule toggles, the reason text, and a grid of more than 4000 pairs that checks every value is in the shared lists. `routes.test.ts` covers preview with an old config, create with edited and invalid transitions, PATCH (settings, applied, both, 400, 404) and an old-shape row.

## Parking lot

- When `PRESET_VALUES` gets entries, check that Sheet Styles still produce Custom where a named preset would mislead.
- The "no key" warning in `order.ts` says "left on Auto" even when the Auto rule is off.
