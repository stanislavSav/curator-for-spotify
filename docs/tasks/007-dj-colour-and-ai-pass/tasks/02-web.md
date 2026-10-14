# 02 — Web: Colour control, AI pass button, bars fix, track-data hints

## Goal

Let the user pick a Transition Colour, run an AI Pass on a preview or a created set, see and switch between the rule and AI versions of each pair, and stop the sheet from offering bar lengths that Spotify does not have.

## What changed

All in `apps/web/src/pages/DjPage.tsx` and `apps/web/src/pages/dj/`.

- **Bars**: only 2, 4 and 8 in the card select (`BAR_OPTIONS`); the default length is 4 or 8. Set Templates that used 16 now use 8. Stored configs go through `normaliseDjConfig`, which clamps. A card with bars shows a muted "if Spotify offers bars". When `barsMayBeHidden` is true it shows "Spotify may show no bar choice here (no clear beat) — skip it." instead. Apply mode, Copy and Print show the same note (`ai.ts › barsNote`).
- **Colour** (`ConfigPanel.tsx`): a Subtle / Medium / Bold control under Sheet Style, with the `TRANSITION_COLOURS` text as tooltip and help line. The closed summary reads "Balanced · Medium colour · 8 bars".
- **AI pass button** (`AiPass.tsx › AiPassButton`): a dark rounded pill with a sparkle icon in the Transition Sheet header, left of Apply mode, for previews and created sets. A click runs at once; the caret opens an optional focus field. With no agent CLI the button is disabled and its tooltip says how to install one. While it runs, the button says "Thinking…" and a line above the cards shows the job message; the sheet stays usable.
- **Result** (`hooks.ts › useAiPass`, `ai.ts`): a banner "AI pass by Claude Code: <summary> · 15 changed · 1 rejected" with a dismiss button, or the error. For a preview, `mergeAiResult` sets `ai` on each pair and takes the AI settings unless the user edited the pair; it maps results by pair key, so a rebuild during the pass does not misplace them. For a created set, the page shows the stored record from the result.
- **Cards**: a sparkle "AI" badge when the settings come from the AI pass; a compact "Rules: …" / "AI: …" block with "Reset to rules" and "Use AI" when they differ; the AI reason under the rule reason. "edited" now means "matches neither the rules nor the AI".
- **Rebuilds** (`edits.ts › carryEdits`): AI values and user edits stay when the same two tracks still follow each other. Only user edits are counted in the "kept/dropped" note.
- **Track-data hints** (`ai.ts › pairHints`): small chips "vocals ↔ vocals", "instrumental out/in" and "acoustic", from instrumentalness and acousticness.

## Decisions

- The agent's product name (Claude Code, Codex, Gemini CLI) shows only where it names the user's installed tool: the button tooltip, the banner and the AI badge tooltip.
- A pair that the AI confirmed (AI equals rules) gets the AI badge, with the tooltip "… agrees with the rules", but no Rules/AI block.
- An error loading the agent list counts as "no agent installed".
- No shared contract changes.

## How to verify

- `npx vitest run apps/web` (`ai.test.ts`: merge, user-edited pairs, rebuild during a pass, carry-over, banner text, bars note, hints).
- `npx tsc -p apps/web`.
- `PORT=8797 WEB_PORT=5183 npm run demo`, open DJ Set: open Transitions and switch Colour; check the bar hints; press "AI pass" (needs an agent CLI) and see the banner, AI badges and the Rules/AI block.

## Parking lot

- Show which pairs the AI pass rejected, and why, on the cards.
- Remember the last focus text.
