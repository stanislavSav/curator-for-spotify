# 03 — Integration (main session)

## What changed

- `POST /api/dj/ai-pass` returns the Job itself (like every other job route); the server tests were updated. Before this, the web expected the Job but the server sent `{ job }`.
- README: DJ row (rule inputs, Colour, ✦ AI pass), privacy (what the AI pass sends), commands (`AGENT_CLI`). `.env.example` documents `AGENT_CLI`.

## Checked

- Typecheck, 298 Vitest tests (1 live test skipped), 10 guard tests, `check:public`, build.
- End to end in the demo (side ports) with the real Claude Code CLI:
  - **Pass 1:** "✦ AI pass" → "Thinking…" / "Asking Claude Code…" → about 30 s → banner with the summary, "2 changed". Changed cards show the ✦ AI badge and "Rules: … / AI: …" with Reset to rules. The AI kept the 3-band fade for two vocal tracks and dropped a stacked echo.
  - **Pass 2:** right after a reload, it started at once and finished.
- Colour = Medium visibly fills clean blends (filter sweep, echo tail, 4-beat loop on instrumental outros). Track-data chips ("vocals ↔ vocals", "instrumental out") and the "if Spotify offers bars" hint show.

## Parking lot

- The very first click in the session did not start a job and could not be reproduced (most likely the click did not register). Watch for it.
