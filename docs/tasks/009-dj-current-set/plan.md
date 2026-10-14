# 009 — DJ Set: keep the current set across page changes; Clear set

**Status:** done (2026-10-14)

## Input

The owner reported that changing pages (and maybe other moments) triggered "Regenerate" and replaced the tracks and the Transition Sheet. They asked that the progress is kept and changes only after Generate or Regenerate, and for a button to drop the current tracklist with its transitions.

## Cause

The DJ page kept its set only in React state. Leaving the page unmounted it. Coming back created a new random seed and built a new set on mount; a reload did the same.

## Fix

- **Current Set saved on the server.** New one-row table `dj_workspace` and `GET/PUT/DELETE /api/dj/workspace`. It holds the config, seed, tracks, Transition Sheet (edits, AI values) and the linked Draft. The page restores it on open and autosaves after every change (debounced); the footer shows "saved".
- **No build on mount, and none on a seed or settings change.** A build happens only on Generate set (empty state or footer), Regenerate, Rebuild set, a Set Template, or a track action.
- **Clear set** (footer, with an inline confirmation) drops the tracklist and sheet; settings, templates and Drafts stay.
- **Full Backup:** `work.djWorkspace` is exported. On import it is restored only when the device has no Current Set, so work in progress is never replaced. `ImportResult.djWorkspace` reports `restored`, `kept-current` or `none`.

## Checked

- Typecheck, all tests (new: workspace routes; Full Backup restore vs kept-current).
- In the demo:
  - The empty page waits for Generate set.
  - After generating, the same set (first track, seed) is still there after switching to Library and back, and after a full reload.
  - Regenerate gives a new seed and new tracks.
  - Clear set shows a confirmation, then the empty state; the server holds no Current Set.

## Follow-up: the AI pass suggests a set name (2026-10-14)

- **Prompt:** asks for a name of 2–6 words; no emoji, no quotes, no track or artist names; at most 60 characters.
- **Parser:** `cleanSetName()` strips quotes, emoji and trailing punctuation and cuts at a word boundary. `AiPassResult.setName` is null when the name is unusable.
- **Banner:** "Suggested name: …"
  - On the Current Set, **Use this name** prefills Save draft and Create on Spotify.
  - On a Draft, **Rename to this** renames it.
  - On a set already on Spotify, the name is shown only.
  - The name is reset when the set gets a new seed.
- **Checked live in the demo with Claude Code:** it suggested "Neon Alt Pop Lift"; Use this name → ✓ Done; Save draft was prefilled with it.

## Follow-up: `npm run demo` left its server running after a normal stop

Stopping the demo with SIGTERM (e.g. `pkill`) ended npm and Vite but not the server, because `tsx watch` ignores SIGTERM and restarts the server on the next file change. `scripts/demo.mjs` now sends SIGTERM to each child's process group, then SIGKILL after 600 ms. Verified: no process remains on the demo ports after a stop.
