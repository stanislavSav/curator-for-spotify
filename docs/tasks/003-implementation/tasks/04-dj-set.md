# 04 — DJ Set: Pool, ordering, Transition Sheet, create on Spotify

**Status:** done (step 1)
**Inputs:** research `02-mix-transitions.md`, `04-audio-features-sources.md` §6, ADR 0002.

## Goal

The user picks a Pool and a set shape. The app orders the tracks by BPM, Camelot key and an Energy Curve. It shows a chart and a Transition Sheet, and creates the DJ Set as a new private playlist. The user then applies the Transitions by hand in Spotify › Mix (ADR 0002).

## What was built (files)

Shared:

- `packages/shared/src/dj.ts`: `DjSetConfig` (Pool, length, Energy Curve, tempo, key strictness, artist spacing, start/locked/excluded tracks, Transition preferences), `DjSetResult`, `DjTransition`, `DjScore`, `DjPoolStats`, API types, `DEFAULT_DJ_CONFIG`, `CURVE_PRESETS` + `curveTarget()`, `TRANSITION_STYLES` (with verified/UNVERIFIED status), `BARS_NOTE`, `DJ_PLAYLIST_DESCRIPTION`.

Server (`apps/server/src/features/dj/`):

- `harmony.ts`: signed half/double-aware tempo delta, `bpmCost`, `keyCost` (research §6.2), `keyRelation`, `parseCamelot`.
- `transitions.ts`: `suggestTransition()`, the rule engine for one pair.
- `order.ts`: `buildDjSet()`: greedy nearest neighbour, then 2-opt and swap-in under a fixed evaluation budget; score and warnings.
- `pool.ts`: `selectPool()`, `buildCandidates()` (tempo filter, BPM range, exclusions, locked/start tracks), `poolOptions()`.
- `rng.ts`: seeded PRNG (mulberry32).
- `schema.ts`: zod schemas for the request bodies (type-checked against the shared types with `satisfies`).
- `sets.ts`: `dj_sets` reads/writes and `createDjSet()`.
- `routes.ts`: `makeDjRoutes(deps)` + `djRoutes`.
  - `GET /api/dj/pool-options`
  - `POST /api/dj/preview` `{config, seed}` → `DjSetResult` (no Spotify calls)
  - `POST /api/dj/sets` `{name, config, result}` → `202 {job, setId}`, job kind `create-dj-set`; `409` if one runs
  - `GET /api/dj/sets`, `GET /api/dj/sets/:id`
- Tests: `harmony`/`transitions.test.ts`, `order.test.ts`, `pool.test.ts`, `routes.test.ts` (in-memory DB, fake `fetch`), and the `test-helpers.ts` used by them.

Web:

- `apps/web/src/pages/DjPage.tsx`: the page, build/regenerate/remove/lock/start actions, create flow, history.
- `apps/web/src/pages/dj/ConfigPanel.tsx`: presets, Pool picker, length, curve editor with an SVG preview, BPM range with a histogram, max step, half/double, key strictness, artist spacing, Transition defaults and rule toggles.
- `apps/web/src/pages/dj/SetChart.tsx`: energy vs target chart and a separate BPM chart, with a shared hover tooltip.
- `apps/web/src/pages/dj/TransitionSheet.tsx`: the sheet table.
- `apps/web/src/pages/dj/ApplyPanel.tsx`: the "How to apply in Spotify" panel, "Copy sheet as text" and "Print".
- `apps/web/src/pages/dj/sheet.ts` (+ test): text and print-HTML export, formatting, half/double folding for the chart.
- `apps/web/src/pages/dj/presets.ts`: "Friday warm-up", "Running 170", "Chill dinner"; the config is saved in `localStorage`.

## Decisions

| Decision | Reason |
|---|---|
| The Pool is the union of the sources that are on (playlists ∪ filtered Library ∪ recent favourites). | Decisions log batch 3b: "they can be combined". |
| Locked and start tracks join the candidates even when they are outside the Pool. | The user picks them from the sheet. They must stay after the Pool changes. |
| Tracks without tempo (or tempo 0, Deezer's "unknown") are dropped and counted. Tracks without a key or energy stay in the set. Unknown energy counts as 0.5 with a small penalty. Unknown key gets a flat cost. | Tempo is the minimum needed to order. Key coverage is uneven (research 04). |
| One process selects and orders: the greedy step picks from the whole Pool with a cost that includes `|energy − target(p)|`. A swap-in move then replaces tracks with unused Pool tracks. | A separate "select by energy first" step ignores BPM and key, so the order step has nothing smooth to work with. The swap-in move does the selection job together with the order. |
| Cost = BPM (log ratio, 1.0 = one max step) + Camelot cost (research §6.2, capped at 4) + 0.5·energy step + target fit + artist-spacing penalty. A pair over the max step or the key limit gets +3. | Research 04 §6.4 with its start weights. Energy is scaled ×4 so 0.25 off the curve weighs like one tempo step. |
| The search stops after an evaluation budget (3 M), not a time cap. | A time cap makes the result depend on the machine. A budget keeps "same seed → same set". A 3000-track Pool with a 40-track set runs in well under a second. |
| The seed adds small per-track preference noise and picks among the 3 best openers. | Regenerate must give a different but still good set. |
| Minutes → track count from the Pool's mean duration. | Simple. Position on the curve is by track index. |
| Transition rules run in this order: tempo jump or key clash → short Fade (2 bars + "cut?" if very big) · key unknown → Auto · energy +0.15 → Rise 8 · compatible key and ≤ 3 % → Blend/Fade 8–16 with "swap lows" · energy-boost key move → Rise · energy −0.15 → Fade · fallback Fade (default bars) or Auto. | A known tempo jump matters even when a key is unknown. The other order follows the brief. |
| Blend is offered, but it is marked "likely" and has a `*` and an "unverified" badge. The EQ details of Fade and Rise are marked UNVERIFIED in the tooltips. 16 bars has a tooltip that Spotify's bar choices are UNVERIFIED. | Research 02: only Auto, Fade and Rise are on Spotify pages. Blend is from press. Bar values are from community reports. |
| `keyRelation` adds `'unknown'`. The diagonal move (8A → 9B) is shown as `energy-boost`. | Keys can be missing. Research groups diagonal with the "extra" moves. |
| Energy and BPM are two charts on one x axis, not one dual-axis chart. With half/double on, the BPM chart shows the tempo a track mixes at (85 → 170). | A dual axis misleads. Without folding, a correct half-time pair looks like a big jump. |
| Create always makes a new private playlist, with the description from the brief. Rebuilding never edits an old playlist. | ADR 0002: a reorder can reset Mix Transitions. |
| `makeDjRoutes({db, client})` factory. | Lets the route tests use an in-memory DB and a fake Spotify client. |
| Print opens a standalone HTML page (blob URL) and calls `print()`. | The app header is not mine. A separate page needs no print CSS in shared files. |

## How to test manually

1. Sync and Enrich so that tracks have BPM, key and energy.
2. Open **DJ Set**. Choose a playlist, or "Last 4 weeks", or the whole Library with a tag. Press **Build set**.
3. Check the stats, the warnings (for example "N Pool tracks have no BPM and were skipped"), the chart (hover a point), and the sheet.
4. Press **Regenerate**: you get a different set. Press **Lock** on a track, then Regenerate: the track stays. **Start** puts a track first. **Remove** builds the set again without the track ("Bring back" in the panel undoes it).
5. Try the presets. Change the curve to Custom and drag the points. The preview updates.
6. **Copy sheet as text** and paste it somewhere. Press **Print**: a clean page opens with the print dialog.
7. **Create on Spotify**, enter a name, and create. The progress bar runs. Then a link and the "How to apply in Spotify" panel appear. Check in Spotify that the playlist is private, in this order, with the description.
8. Under **Earlier sets**, press **View sheet**. "Use these settings" copies the config back into the form.

## Known gaps

- With a small Pool, the energy line can dip far off the curve: the cost prefers a key match over the energy fit. The weights are constants in `order.ts` (`WEIGHTS`) and are not shown in the UI yet.
- Minutes mode estimates the track count from the mean duration. The real length can differ by a few minutes.
- No search to choose a start track or a locked track before the first build. You choose them from the sheet.
- Transitions are advice only. The app cannot check what Spotify offers for a pair (no API).
- The page was checked visually against a mock server with fake data. It was not checked against the real dev server or a real Spotify account (parallel-work rule).

## Parking lot

- Weight sliders (BPM / key / energy) and the "energy step" weight in the UI.
- Or-opt moves and multi-start runs for big sets.
- Manual BPM/key override per track (research 02 §5: read the values from Spotify's Mix view).
- Use Streaming History skips or play counts as a "favourite" bonus in the Pool.
- "Duplicate as new set" from history, which keeps the order and only renames it.
