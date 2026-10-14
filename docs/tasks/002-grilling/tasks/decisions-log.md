# Decisions log

## Batch 1 — account and pruning safety (2026-10-13)

Asked while the research agents were running.

| Question | Answer | Consequence |
|----------|--------|-------------|
| Spotify account and developer app? | Answered (account details are not published) | Write a setup guide to create the Spotify app (Client ID, redirect URI). The app owner needs Premium (a Development Mode rule). |
| Request the data export now? | Yes | The user requests "Extended streaming history" now. The app must work without it and improve after import. |
| How safe is deleting? | Review, then confirm | The tool lists Prune Candidates with reasons. The user ticks and confirms. A Backup is saved before each prune. |
| Which playlists are in scope? | Owned and followed | Owned → delete. Followed → unfollow. Generated Playlists are excluded. |

## Batch 2 — analysis scope (2026-10-13)

Asked after research topics 01 and 05 were done.

| Question | Answer | Consequence |
|----------|--------|-------------|
| What does "define playlists" mean? | Propose NEW playlists | The tool proposes new named playlists. Existing ones are only touched by pruning. |
| Sources for analysis | Liked Songs, Owned Playlists, Top tracks/artists, Streaming History | Followed Playlists are not analysed; the API does not return their tracks anyway. |
| Claude API key? | No key: the agent prepares the Proposals in the user's own session, and the web page is for approving and editing them. | No Anthropic key in the app. Claude Code (in a session) reads a data snapshot and writes the proposals. The web app reviews, edits and applies them. See ADR 0001. |
| Play-log poller? | No poller | Usage evidence comes from the data export, playlist edit dates, and the last 50 plays at sync time. |

## Batch 3a — DJ / Mix (2026-10-13, asked on its own)

Research 02 found that Spotify Mix transitions have no API at all.

| Question | Answer | Consequence |
|----------|--------|-------------|
| What should the DJ part do? | Order + Transition Sheet | The app orders the tracks by BPM, Camelot key and a configurable Energy Curve, then creates the playlist. It also shows a Transition Sheet: one suggested Mix transition per adjacent pair. The user applies it in Spotify › Mix › Edit. See ADR 0002. |

## Batch 3b — workflow and thresholds (2026-10-13)

| Question | Answer | Consequence |
|----------|--------|-------------|
| Claude workflow: Sync → Snapshot → Claude writes Proposals → app reviews and applies | Yes, exactly | Add a repo slash-command `/propose-playlists`. Prune scoring and DJ ordering run in the app. |
| Technical log export (`KmPageView.json`)? | Skip it | There is no "opened" signal. Followed Playlists have no readable tracks, so they only have recently-played context as evidence. Show them in their own "no evidence" group and never pre-tick them. |
| Prune threshold | 12 months, adjustable | Default N = 12 months, with a slider. |
| DJ Set pool | Chosen playlists, whole library + filters, recent favourites | The pool builder supports all three, and they can be combined. |

## Closed

All design branches are agreed. Implementation continues in task 003.
