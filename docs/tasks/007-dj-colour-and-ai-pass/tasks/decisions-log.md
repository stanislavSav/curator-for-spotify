# Decisions log — transition colour, richer track data, AI pass

## Input (2026-10-14)

The owner noticed that the cards very often say "None" and asked why, and whether the calculation is AI or an engine. Answer: it is a fixed rule engine; a well-ordered set puts most pairs in the "long blend" or "standard" situations, whose recipes are Volume + EQ only.

They asked to implement:
1. a **Colour** setting (subtle / medium / bold) that adds filters, effects and loops to clean blends;
2. using **more track data**: instrumentalness, vocals, acousticness, danceability, position in the set;
3. an **AI pass** as a button on the generated set, styled like Spotify's "✦ Auto" button (dark rounded pill with a sparkle icon).

Then, mid-task, they reported two problems with bars: the sheet offers 16 bars, but Spotify's maximum is 8, and sometimes Spotify shows no bar choice at all.

## Decisions

| Question | Answer | Consequence |
|----------|--------|-------------|
| How does the AI button reach an AI without a key? | Run the user's agent CLI headless | The server spawns `claude`, `codex` or `gemini` (whichever is installed, or `AGENT_CLI`) with the set as text, no tools, and reads JSON from stdout. Every value is validated against Spotify's option lists. See ADR 0004. |
| Bars | Spotify: max 8; sometimes no choice | `TransitionBars` = 2 / 4 / 8. Stored 16 is clamped to 8. Cards say "If Spotify shows no bar choice, skip it". `barsMayBeHidden` flags pairs with likely no beat grid. |
| Default colour | Medium | The complaint was too many "None". Subtle keeps the old behaviour. |

## Correction (2026-10-14, later)

The owner corrected the bars decision: **16 bars is possible too, but Spotify offers it only for some tracks.**

- `TransitionBars` = 2 / 4 / 8 / 16 again; `toBars` snaps 12 → 16. The API accepts exactly these four values; stored odd values are normalised on read.
- **Rules:** a long blend with the same key and a tempo change of 1.5 % or less → 16 bars. Smooth & long doubles bars up to 16; Ambient washes uses 16 except on clashes; Club halves them. Default bars may be 4, 8 or 16.
- **Every 16-bar suggestion carries a note:** "Spotify offers 16 bars only for some tracks — if it is not offered here, use 8." It appears on the card, in Apply mode, and in the copied and printed sheet.
- **AI pass prompt:** "use 16 only for long blends between compatible tracks with nearly the same tempo, otherwise 8 or less".
