# 02 — Web: settings panel, Spotify-style Transition Sheet, Apply aids

## Goal

Make the DJ Set settings quick to change, and make the Transition Sheet easy to apply in Spotify's "Edit transition" panel.

## What changed

All in `apps/web/src/pages/DjPage.tsx` and `apps/web/src/pages/dj/`.

- **Settings panel** (`ConfigPanel.tsx`): Set Templates chips at the top (renamed from presets, `templates.ts`), then folding sections Pool, Shape, Tempo, Key, Transitions (Sheet Style, default bars), Advanced (half/double, artist spacing, the four rules). A closed section shows a one-line summary (`summaries.ts`). Pool and Shape are open at first. A footer that is always visible shows the rebuild status and Regenerate. The Build button is gone.
- **Live preview** (`hooks.ts › useLivePreview`): each settings change rebuilds after 400 ms with the same seed. A newer change cancels the request in flight. Locks do not rebuild. The last config is kept in localStorage and loaded through `normaliseDjConfig`.
- **Cards** (`TransitionCard.tsx`, `TransitionSheet.tsx`): one card per pair: "3 → 4 · 8 bars · Custom", outgoing and incoming track (BPM, Camelot), the preset line, the five rows in Spotify's colours with exact values or "— preset decides", tempo/key/energy chips, the reason. The legend is shown once above the cards. The track table (Lock, Start, Remove) moved to a folding "Tracks" card.
- **Edit**: Mix Preset chips, bars select, and one select per row (Custom only). Auto and No transition clear the bars and rows; other named presets keep the bars and clear the rows ("Values set by Spotify"). "Reset to suggestion" and an "edited" badge. In a preview, edits live in page state and go with Create; a rebuild keeps an edit when the same two tracks still follow each other, and says how many it kept or dropped (`edits.ts › carryEdits`).
- **Created sets** (`hooks.ts › useDjSet`): edits and Applied ticks PATCH the server, with an optimistic update. The sheet header shows "7/18 applied". Applied cards are dimmed with a check. After Create, and from "Earlier sets", the page opens the saved set so the user can go on applying.
- **Apply mode** (`ApplyMode.tsx`): a full-screen view of one card. Prev/Next, ← →, Space marks applied and goes next, Esc closes, progress bar, "Open playlist in Spotify". Read-only for a preview.
- **Copy and Print** (`sheet.ts`): each pair lists the preset line, bars and all five rows; created sets add the Applied ticks.

## Decisions

- Any change in the settings panel returns from a saved set to the builder, because the panel only drives the builder.
- Rows are editable only with Custom. A named preset other than Auto and No transition keeps its bars, because Spotify still shows the bars pill for it.
- No shared contract changes.

## How to verify

- `npx vitest run apps/web` (edits, summaries, sheet export).
- `npx tsc -p apps/web`.
- `PORT=8797 WEB_PORT=5183 npm run demo`, open the DJ Set page: change a setting and see "Rebuilding…" then "Rebuilt just now"; edit a card, change the Sheet Style, and see the edit kept. Demo mode blocks Create, so to check a saved set, add one to `data/demo/` with `saveDjSet`.

## Parking lot

- Remember which panel sections are open.
- Name a matching preset when `PRESET_VALUES` gets entries.
