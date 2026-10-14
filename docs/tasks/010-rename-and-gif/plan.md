# 010 — Rename to "Curator for Spotify"; demo GIF in the README

**Status:** done locally (2026-10-14); the GitHub repo rename waits for the owner's go-ahead.

## Input

Before sharing the project on Reddit, the owner asked to rename it and to add a GIF to the README.

## Why rename

The Spotify Developer Policy and branding guidelines say an app name should not start with "Spot" and must not suggest that Spotify made or endorses it. "Spotify Curator" did both. "Curator for Spotify" follows the allowed "<name> for Spotify" pattern.

## Decisions

- **Name:** "Curator for Spotify". Repository: `curator-for-spotify`. GitHub redirects the old URL.
- **Visible name changed everywhere:** README, AGENTS.md, CONTEXT.md, SETUP.md, the propose-playlists skill, the page title and header, the setup step text, the description added to created playlists (" · by Curator for Spotify") and DJ Sets, and the MusicBrainz / Wikidata User-Agent (`CuratorForSpotify/0.1`). The npm root package name is now `curator-for-spotify`.
- **Full Backup format id stays `spotify-curator-backup`**, so backups made before the rename still import. Only the download file name changes, to `curator-for-spotify-backup-<date>.json`. `.gitignore` and the privacy guard block both the old and the new file names.
- **Not changed:** the internal workspace scope `@curator/*`, and the task history in `docs/tasks/001–009` (it records what was true then).
- **Playlists already on Spotify** keep the old suffix in their descriptions. The app does not rewrite them.

## GIF

- Recorded in demo mode (fake library, no Spotify calls) on side ports, so the owner's running app was not touched.
- Flow: Generate set → energy and tempo chart → Transition Sheet → Edit a card and pick Rise → Apply mode, stepping through three transitions. A green ring marks each control just before it is clicked.
- **First take (pushed in the rename commit) looked blurry.** The browser extension's recorder captures frames at about a third of the screen's real resolution, and the frames were then shrunk to 960 px with 128 colours.
- **Second take:** a separate headless Chrome, driven over the DevTools protocol, with a 1200 × 760 viewport at 2× pixel density. PNG frames were halved to 1200 px with a 256-colour palette per frame and no dithering, giving 26 frames and about 2.2 MB. The recording script is a throwaway and was not committed.
- Saved as `docs/screenshots/demo.gif`, at the top of the README. The Proposals screenshot moved into "More screenshots".
- The GIF shows demo data only, and the privacy guard passes.

## Checked

- Typecheck, 347 tests, 11 guard tests, `check:public`.

## Left for the owner

- Rename the GitHub repository (`gh repo rename curator-for-spotify`), update the `origin` URL and the repo description, push.
- Update the links in the Reddit post drafts.
