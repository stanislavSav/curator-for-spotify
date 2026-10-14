# Decisions log — DJ Set usability and Spotify-shaped Transition Sheet

## Input (2026-10-14)

The owner asked for two things: (1) make the left side (set settings) more convenient; (2) extend the Transition Sheet to match Spotify's "Edit transition" panel, so the suggestions are easier to apply. They sent screenshots of the panel and every dropdown. The screenshots are not kept in the repo because they show tracks from their library; their content is transcribed below and in `packages/shared/src/dj.ts`.

From the screenshots, Spotify's editor has:
- **Presets:** Custom, Auto, Fade, Rise, Blend, Wave, Melt, Slam, Dissolve, Surge, Afterglow, No transition.
- **Bars** pill (8 bars seen).
- **Volume** (8 options), **EQ** (9), **Filter** (11), **Effects** (12), **Looping** (6), with colours blue, yellow, pink, white, orange.
- **Both tracks** with BPM and Camelot key.

## Batch 1

| Question | Answer | Consequence |
|----------|--------|-------------|
| Left panel | Compact accordion + live preview | Folding sections with one-line summaries, Advanced collapsed, auto-rebuild after each change, last config remembered. |
| Sheet view | Spotify-style card per pair | Card: outgoing → bars → incoming (BPM, key), preset, then the five rows in Spotify's colours and exact option names, plus the reason. |
| Apply aids | Edit each transition; "Applied" checklist; Apply mode; transition style presets | All four. The set-wide "transition style presets" are called **Sheet Styles** to avoid clashing with Spotify's presets. |
| Preset or explicit values | The owner sent the full preset list | We cannot see what Fade…Afterglow set. The sheet suggests **Custom + the 5 exact values**. It uses only the two presets with a clear meaning: **Auto** (keys unknown) and **No transition** (hard cut). `PRESET_VALUES` is an empty mapping table; once the owner looks up a preset's values, the sheet can name it when it matches. |

## Naming

- The DJ page's config presets ("Friday warm-up"…) are renamed **Set Templates** in the UI, so "preset" means only Spotify's Mix presets.
