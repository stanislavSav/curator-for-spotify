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

## Follow-up: Saved sets in a drawer (2026-10-14)

The owner found the layout awkward: Earlier sets sat at the bottom of the page, while the question and the opened set appeared at the top.

- **The bottom card is gone.** A **Saved sets** button with a count in the DJ page header opens a slide-over drawer from the right (`dj/SetsDrawer.tsx`, a generic `Drawer`). It holds the filter (All / Drafts / On Spotify) and the list. Esc, ✕ or a click on the backdrop closes it, and the page behind does not scroll.
- **The "replace your current set?" question** shows inside the drawer, right under the clicked row (`EarlierSets.afterRow`). Its text sits above its buttons. When the question comes from elsewhere (e.g. "Open in builder" on a saved set's view), it shows at the top as before.
- **Opening a set or choosing Apply in Spotify closes the drawer.** The open set is marked "Open in builder".
- **Checked in the demo:**
  - Unsaved set → Saved sets → click "Sunday Deep Drift" → the question appears under it → Replace it → the drawer closes and the draft opens exactly (same first track, "Editing draft" note).
  - Reopening the drawer shows the "Open in builder" badge; Esc closes it.

## Follow-up: Update on Spotify (2026-10-14)

The owner noticed there was only "Create on Spotify": a set that was already on Spotify could not be updated.

- **Server:** `POST /api/dj/sets/:id/update` (`DjSpotifyUpdateRequest`: name, config, result) starts job `update-dj-set`.
  - It replaces the playlist's items: PUT `/playlists/{id}/items` with the first 100, then POST the rest (`SpotifyClient.replaceItems`).
  - It renames the playlist when the name changed (PUT `/playlists/{id}`, `updatePlaylistDetails`). A failed rename does not undo the track update.
  - It stores the new config and sheet. Applied ticks stay only on pairs (outgoing → incoming track) that did not change.
  - A 404 from Spotify ("playlist gone") turns into a clear message.
  - It returns 409 for Drafts and while a create or update runs; it is blocked in demo mode (route and guard).
- **Web:** when the Current Set is a copy of a set on Spotify, the panel becomes **Save to Spotify** with **Update "…" on Spotify**, *Create a new playlist*, *Save draft* and *Open in Spotify*.
  - Update asks for the name (prefilled) and warns that Spotify may reset transitions already set in Mix after a reorder (ADR 0002), and that changed pairs lose their Applied tick.
  - After the job, the copy's name follows the playlist.
- **Removed** the "Update draft" button: Drafts already save automatically.
- **Checked:**
  - Route test with a fake Spotify: replace + rename calls, name and tracks stored, ticks kept on the unchanged pairs only; Drafts refused; unknown set 404.
  - In the demo (with a set marked "on Spotify" in the demo database only): opening it shows the Save to Spotify panel and the confirmation; the update is refused with the demo message.
  - Not run against the real Spotify account.

## Follow-up: set header, name, in-sync Update, quieter warnings (2026-10-14)

The owner reported:
- "Use this name" did nothing.
- It was not clear which saved set was open; the long copy note was too wordy.
- The pool and key warnings should be hidden.
- Update on Spotify should be active only when something changed.

- **Set header** (`dj/SetHeader.tsx`) replaces the long notes. It is one line:
  - a badge (New set / Draft / On Spotify);
  - the **name** (click to rename; a linked Draft is renamed on the server at once);
  - a short status: Saved / Saving… for a Draft; In sync with Spotify / Changed · not on Spotify yet / Updating Spotify… for a copy; "Not saved yet" for a new set;
  - Open in Spotify.
- **The Current Set's name** (`setName`) is the single source. It comes from the Draft or Spotify set, typing in the header, or "Use this name". It prefills Save draft, Create (made unique) and Update. It is saved with the Current Set, together with the link to the Spotify set (`dj_workspace.based_on_json`, `name`, added by migration), so a reload keeps both.
  - Root cause of "Use this name does nothing": it only set a hidden value used when a form opened; a copy's Update form ignored it.
- **Update on Spotify** compares the Current Set with the stored set (`contentKey`: config, track order, sheet values; Applied ticks ignored) and the name. With nothing to update, the button reads "Up to date on Spotify" and is disabled.
- **Warnings** collapse into "⚠ N notes about this set · show".
- **Checked in the demo:**
  - Opened a set marked "on Spotify": the header showed "In sync with Spotify" and Update was disabled.
  - Colour → Bold: "Changed · not on Spotify yet" and Update became active.
  - AI pass → Use this name: the header name changed to the suggestion.
  - Reload: the name, the link and the status stayed.

## Parking lot

- Full Backup exports `dj_workspace` without the new `based_on_json` and `name` columns. A restored Current Set loses its Spotify link and name, which is harmless.
