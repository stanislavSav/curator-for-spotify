# Decisions log — templates, drafts, Full Backup

## Input (2026-10-14)

The owner asked for:
1. saving a template;
2. saving a playlist for later without creating it on Spotify;
3. a backup of the whole configuration that can be imported later, e.g. when the device changes.

## Batch 1

| Question | Answer | Consequence |
|----------|--------|-------------|
| What does a saved template store? | Settings; Pool optional | Shape, Tempo, Key, Transitions and Advanced, plus the Pool when "Include Pool" is ticked. User Set Templates sit next to the built-in ones and can be renamed and deleted. Without the Pool, applying one keeps the current Pool. |
| Which playlists can be drafts? | DJ Sets | "Save draft" stores the set (order, sheet, edits, AI values) with status `draft`. Drafts show in "Earlier sets" with a Draft badge, and can be opened, edited and created on Spotify later. |
| Full Backup content | Work + optional library cache | Always included: templates, DJ Sets (drafts and created), Proposal decisions and the proposals file, prune Backups and the prune log, and the browser's DJ settings. Optional: the synced library and enrichment cache, so a new device skips the long enrich. Never included: Spotify tokens. |
| Import into an app with data | Merge, ask on conflicts | The import preview lists new items and conflicts. For each conflict: keep mine / take the backup's / keep both. The library cache is all-or-nothing: replace or skip. |

## Naming

"Backup" already means one playlist saved before pruning. The whole-app file is a **Full Backup**.
