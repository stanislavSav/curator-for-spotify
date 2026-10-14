# 003 — Parking lot

Out of scope for the first version. Each workstream adds items under "Parking lot" in its own task file; the main session merges them here.


### From 01-sync
- Incremental Liked Songs: stop paging when `added_at` reaches the newest known entry and the total is unchanged.
- Store `genres` from top artists when `genres_json` is NULL (free data for enrich).
- Automatic sync on page open when the last sync is older than N hours, to collect more recent plays.
- Record per-playlist 403s in the summary so the UI can list them.

### From 02-enrich-snapshot
- "Manual override" for BPM/key in the table.
- Essentia.js key/BPM from the Deezer 30 s preview for tracks ReccoBeats misses.
- Last.fm tags if the user adds a key.
- A "Cancel" button for long jobs (needs a cancel hook in `jobs.ts`).
- Show per-source attempt counts (tried / not found) on the Library page.

### From 03-prune
- Restore an Owned Playlist by following its original URI again (`PUT /me/library`), which may bring back the original with its followers. Needs a real test first.
- Use `Playlist1.json` (`lastModifiedDate`) and `SearchQueries.json` from the account-data export as extra evidence.
- Show plays of shared (non-exclusive) tracks as weak evidence, and coverage per playlist.
- Warn when an Owned Playlist has followers (`numberOfFollowers` in the export).
- A "clear history" button and an import log table.

### From 04-dj-set
- Weight sliders (BPM / key / energy) and the "energy step" weight in the UI.
- Or-opt moves and multi-start runs for big sets.
- Manual BPM/key override per track (research 02 §5: read the values from Spotify's Mix view).
- Use Streaming History skips or play counts as a "favourite" bonus in the Pool.
- "Duplicate as new set" from history, which keeps the order and only renames it.

### From 05-proposals
- "Regenerate this one" button that writes a note for the next `/propose-playlists` run (for example "fewer tracks", "more upbeat").
- Show Proposal-to-Proposal overlap on the cards (it is in the file check only).
- A preview player (30 s previews are gone from the API; would need the Web Playback SDK).
