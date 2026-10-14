---
name: propose-playlists
description: Read the user's Spotify Snapshot (data/snapshot.json) and write new playlist Proposals to data/proposals.json for review in the Curator for Spotify app. Use when the user asks to propose playlists, for new playlist ideas, or for Proposals.
argument-hint: "[optional focus, e.g. 'more running playlists' or 'only 90s']"
allowed-tools: Read, Write(data/proposals.json), Edit(data/proposals.json), Bash(npx tsx apps/server/src/features/proposals/scripts/:*), Bash(npm run validate-proposals:*), Bash(jq:*), Bash(ls:*), Bash(date:*)
---

Follow `.agents/skills/propose-playlists/SKILL.md` exactly. Read that file first.

User focus for this run (may be empty): $ARGUMENTS
