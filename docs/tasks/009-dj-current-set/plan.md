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

## Follow-up: open earlier sets to keep working on them (2026-10-14)

The owner found it uncomfortable that earlier sets could not simply be opened and changed, and that "Continue applying" did not fit.

- **The whole row is clickable** (Enter or Space as well) and opens the set in the builder **exactly as saved**: same tracks, sheet, edits and AI values, with no rebuild (`useLivePreview.load`).
  - **Draft:** it becomes the Current Set and stays linked. Every change is saved back to the draft automatically (debounced PUT). The note above the set reads "Editing draft “…” · changes are saved to it automatically".
  - **Set on Spotify:** it opens as a copy, with Applied ticks reset. A note says the Spotify playlist does not change; save the copy as a new draft or create a new playlist.
  - The open row is marked "Open in builder".
- **Unsaved Current Set:** opening another set asks first, with "Save it as a draft, then open" / "Replace it" / "Cancel". A Current Set linked to a draft is already saved, so the question is skipped.
- **Save draft now stays in the builder,** linked to the new draft, instead of switching to a read-only view.
- **"Continue applying" / "Open draft" become "Apply in Spotify n/m"** (sets on Spotify only). "Use these settings" becomes "Open in builder".
- **Checked in the demo:**
  - Unsaved set → click "Draft A" → confirmation → Replace it → the draft opened with its own first track and the "Editing draft" note.
  - Colour → Bold was saved to the draft on the server (`updatedAt` set, colour bold, same tracks).
