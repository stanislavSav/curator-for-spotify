# Spotify Curator

A personal, local tool that studies one person's Spotify listening, proposes new playlists, removes playlists that are no longer used, and builds DJ-style ordered playlists.

## Library

**Library**:
Everything the user has on Spotify: owned playlists, followed playlists, and liked songs.
_Avoid_: collection, account

**Owned Playlist**:
A playlist the user created. Pruning it means deleting it.
_Avoid_: my playlist

**Followed Playlist**:
A playlist someone else created and the user saved. Pruning it means unfollowing it.
_Avoid_: saved playlist, subscribed playlist

**Generated Playlist**:
A playlist that Spotify makes for the user (Discover Weekly, Daylist, Blend, and similar). It is never a Prune Candidate.
_Avoid_: algorithmic playlist, made-for-you

**Streaming History**:
The per-play records from Spotify's "Download your data" export. The user imports it into the tool.
_Avoid_: listening log, scrobbles

## Pruning

**Prune**:
Remove a playlist from the Library: delete it if owned, unfollow it if followed. It always needs explicit confirmation from the user.
_Avoid_: clean up, archive

**Prune Candidate**:
A playlist that the tool suggests pruning, with the reasons it is considered unused.
_Avoid_: dead playlist, stale playlist

**Backup**:
A local snapshot of a playlist (name, description, tracks in order), saved before it is pruned.
_Avoid_: export, archive

**Usage Evidence**:
A dated fact showing that a playlist was used: a play from the playlist context, a play of an Exclusive Track, or an edit.
_Avoid_: activity, signal

**Exclusive Track**:
A track that appears in only one of the user's playlists and is not in Liked Songs. Playing it counts as Usage Evidence for that playlist.
_Avoid_: unique track

## Proposing

**Snapshot**:
The synced and enriched copy of the Library that an Agent reads to write Proposals.
_Avoid_: dump, export

**Agent**:
An AI coding agent the user runs next to the tool (for example Claude Code, Codex or Gemini CLI). It reads the Snapshot and writes Proposals.
_Avoid_: bot, assistant, LLM

**Basic Proposal**:
A Proposal that the tool builds by rules (tags, tempo, era) when no Agent is used.
_Avoid_: auto proposal, fallback playlist

**Proposal**:
A suggested new playlist: name, description, tracks, and the reason for each pick. The user approves, edits or drops it before it is created on Spotify.
_Avoid_: suggestion, draft playlist

## DJ

**DJ Set**:
An ordered playlist built for smooth transitions by BPM, key and energy. It is meant to be played with Spotify Mix.
_Avoid_: DJ playlist, mix playlist

**Pool**:
The tracks that a DJ Set may draw from: chosen playlists, the filtered Library, or recent favourites.
_Avoid_: source, seed

**Energy Curve**:
The target energy shape across a DJ Set, such as warm-up → peak → cool-down.
_Avoid_: arc, vibe curve

**Mix**:
Spotify's in-app feature that plays a playlist with DJ-style transitions. It can only be configured inside the Spotify app.
_Avoid_: crossfade, automix

**Transition**:
How one track hands over to the next in a Mix: a Mix Preset, a length in bars, and the Transition Settings.
_Avoid_: blend (Blend is one of the presets)

**Mix Preset**:
One of Spotify's named transition presets (Custom, Auto, Fade, Rise, Blend, Wave, Melt, Slam, Dissolve, Surge, Afterglow, No transition).
_Avoid_: style, template

**Transition Settings**:
The five values in Spotify's transition editor: Volume, EQ, Filter, Effects and Looping.
_Avoid_: parameters, knobs

**Sheet Style**:
The flavour of a whole Transition Sheet (Balanced, Smooth & long, Club cuts, Ambient washes) that steers which Transition Settings are suggested.
_Avoid_: preset, mode

**Transition Colour**:
How much a Transition Sheet adds filters, effects and loops to clean blends: Subtle, Medium or Bold.
_Avoid_: spice, intensity

**AI Pass**:
A one-click review of a DJ Set's Transition Sheet by the user's own Agent, run by the app. Its suggestions show as "AI" and can be kept or reset.
_Avoid_: auto mix, AI mode

**Set Template**:
A saved starting point for a DJ Set's settings (for example "Friday warm-up"). Built-in, or saved by the user, with or without the Pool.
_Avoid_: preset

**Draft**:
A DJ Set saved in the tool but not yet created on Spotify.
_Avoid_: unsaved set, local playlist

**Full Backup**:
One file with all of the user's work (templates, DJ Sets, Proposal decisions, Backups, settings), and optionally the library cache, used to move the tool to another device. It never holds Spotify login tokens.
_Avoid_: export, archive (and do not confuse with a Backup, which is one playlist saved before pruning)

**Transition Sheet**:
The tool's per-pair list of suggested Transitions for a DJ Set. The user applies it by hand in the Spotify Mix editor.
_Avoid_: cue sheet, setlist
