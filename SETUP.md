# Setup guide

This guide takes you from an empty machine to your first Proposals. Follow the sections in order. The app also shows steps 2–5 as a checklist on its **Setup & Sync** page.

Terms such as Library, Owned Playlist, Prune and Snapshot have exact meanings. See [CONTEXT.md](CONTEXT.md).

## 1. Prerequisites

- **Node.js 22** or later. Check with `node --version`.
- **Spotify Premium.** Spotify allows Development Mode apps only for owners with Premium. If your Premium ends, the app stops working until you subscribe again.
- **An AI coding agent** (optional), such as Claude Code, Codex, Gemini CLI, Cursor or GitHub Copilot, for the best Proposals. The app itself has no LLM key (see [docs/adr/0003](docs/adr/0003-agent-neutral-proposals.md)). Without an agent, the app can build Basic Proposals by rules.
- A browser on the same machine. The app listens on `127.0.0.1` only.

## 2. Request your Spotify data export (do this first)

The export can take up to 30 days. Request it now, so that it is ready when you need it for pruning.

1. Open <https://www.spotify.com/account/privacy/> and log in.
2. In **Download your data**, tick **Extended streaming history**. You do not need the other options.
3. Click **Request data**.
4. Open the confirmation email from Spotify and confirm the request. If you do not confirm, Spotify does not start the export.

The app works without the export. The export makes Prune Candidates much more accurate, because it holds every play of your account, not only the last 50.

## 3. Create the Spotify app

1. Open <https://developer.spotify.com/dashboard> and log in with your Spotify account.
2. Click **Create app**.
3. Enter a name and a description, for example `Spotify Curator`. Leave **Website** empty.
4. In **Redirect URIs**, enter the URI below and click **Add**:

   ```
   http://127.0.0.1:8787/auth/callback
   ```

   The URI must match exactly. Use `127.0.0.1`. Spotify rejects `localhost`. If you change `SPOTIFY_REDIRECT_URI` or `PORT` in `.env`, register that value instead. The **Setup & Sync** page shows the active URI with a copy button.
5. In **Which API/SDKs are you planning to use?**, tick **Web API**.
6. Accept the terms and click **Save**.
7. Open **Settings** and copy the **Client ID**. You do not need the client secret: the app uses PKCE.
8. If you will log in with a Spotify account that does not own the app, open **Settings › User Management** and add that account. If the account is not on the list, Spotify answers every API call with 403.

## 4. Configure and start the app

1. Copy the example environment file:

   ```sh
   cp .env.example .env
   ```

2. Open `.env` and set your Client ID:

   ```sh
   SPOTIFY_CLIENT_ID=<your Client ID>
   ```

   Keep the other values unless you have a reason to change them.
3. Install the dependencies:

   ```sh
   npm install
   ```

4. Start the server and the web app:

   ```sh
   npm run dev
   ```

5. Open <http://127.0.0.1:5173>. Do **not** open `http://localhost:5173`: the login callback returns to `127.0.0.1`, and a different origin breaks the flow.

If you change `.env`, stop `npm run dev` (Ctrl+C) and start it again.

## 5. Connect and sync

1. On **Setup & Sync**, click **Connect Spotify**. Log in and allow access. Spotify sends you back to the app.
2. Note the "log in again by" date. Spotify ends every login 6 months after you allow access. After that date, click **Connect Spotify** again.
3. Click **Sync now**. The first sync reads every Owned Playlist, so it can take a few minutes for a large Library. Later syncs read only playlists that changed.

Sync reads:

| Data | Notes |
|------|-------|
| Your playlists | Owned, Followed and Generated Playlists. Spotify returns tracks only for Owned and collaborative playlists. |
| Playlist tracks | Only for playlists that changed since the last sync. Local files and podcast episodes are skipped. |
| Liked Songs | Replaced on every sync. |
| Top tracks and top artists | Short, medium and long term, 50 each. |
| Recently played | The last 50 plays. Plays add up across syncs, so sync often to keep more of them. |

## 6. The workflow

```
Connect → Sync → Enrich → Snapshot → AI agent (or basic proposals) → review Proposals → create on Spotify
                       ↘ Prune: import Streaming History → review Prune Candidates → confirm (Backup first)
                       ↘ DJ Set: Pool → Energy Curve → ordered playlist + Transition Sheet
```

1. **Sync** on **Setup & Sync**. Sync again before each of the steps below.
2. **Enrich** on **Library**. The app adds BPM, key, energy and tags from third-party sources, because Spotify no longer gives audio features.
3. **Snapshot** on **Library**. The app writes `data/snapshot.json`, a compact copy of your Library.
4. **Proposals.** Open your AI agent in this folder and ask it to propose playlists (see [Use it with an AI agent](#use-it-with-an-ai-agent)). The agent reads the Snapshot and writes `data/proposals.json`. Without an agent, press **Generate basic proposals** on **Proposals** instead. Then, on **Proposals**, approve, edit or drop each Proposal. The app creates the approved playlists on Spotify.
5. **Prune.** When the data export arrives, open **Prune** and import the Streaming History (the ZIP file or the `Streaming_History_Audio_*.json` files). Review the Prune Candidates and their reasons. Tick the playlists to remove and confirm. The app saves a Backup of each playlist before it removes it. Owned Playlists are deleted, Followed Playlists are unfollowed, and Generated Playlists are never touched.
6. **DJ Set.** Open **DJ Set**. Choose a Pool and an Energy Curve. The app orders the tracks by BPM, key and energy and creates the playlist. Apply the Transition Sheet by hand in Spotify › Mix › Edit (see [docs/adr/0002](docs/adr/0002-transitions-are-advisory.md)). Do not use Spotify's "Smart Reorder" on a DJ Set: it replaces the order.

### Use it with an AI agent

The workflow is written once, in `.agents/skills/propose-playlists/SKILL.md`. `AGENTS.md` tells every agent where it is. Start the agent in the repository folder, then:

| Agent | How to run the workflow |
|-------|-------------------------|
| Claude Code | `/propose-playlists`, optionally with a focus: `/propose-playlists only 90s` |
| OpenAI Codex | `$propose-playlists` (or pick it with `/skills`), or ask "propose playlists" |
| Gemini CLI | `/propose-playlists`, optionally with a focus, or ask "propose playlists" |
| Cursor | `/propose-playlists` in the agent chat, or ask "propose playlists" |
| GitHub Copilot | `/propose-playlists` in VS Code chat; in the CLI or the cloud agent, ask "propose playlists" |
| Any other agent that reads `AGENTS.md` | Ask "propose playlists" |

The agent runs the digest and track scripts, writes `data/proposals.json`, and runs `npm run validate-proposals` until it passes. It never calls Spotify. You create the playlists in the app.

## 7. Where your data lives

Everything stays on your machine in `data/`. Git ignores this folder.

| Path | Contents |
|------|----------|
| `data/curator.sqlite` (plus `-wal` and `-shm`) | The local database: your login tokens, the synced Library, enrichment, Streaming History, Backups, Proposal state, DJ Sets and jobs. |
| `data/snapshot.json` | The Snapshot that your AI agent reads. |
| `data/proposals.json` | The Proposals that your AI agent writes. |
| `data/backups/` | One JSON file per Backup, written before each prune. |

## 8. Back up and reset

**Back up.** Stop `npm run dev`. Copy the whole `data/` folder to a safe place. Stop the server first, because SQLite keeps recent writes in the `-wal` file until the server closes the database.

**Log out.** Click **Log out** on **Setup & Sync**. The app deletes its Spotify tokens. To also remove the app's access on Spotify's side, open <https://www.spotify.com/account/apps/> and remove the app.

**Reset the Library but keep Backups.** Stop `npm run dev`. Delete `data/curator.sqlite`, `data/curator.sqlite-wal` and `data/curator.sqlite-shm`. Start the app, connect, and sync again. This also deletes the imported Streaming History, enrichment and Proposal state, so import and enrich again. The JSON files in `data/backups/` stay.

**Reset everything.** Stop `npm run dev`. Delete everything in `data/` except `data/.gitkeep`.

## 9. Troubleshooting

| Problem | Fix |
|---------|-----|
| "SPOTIFY_CLIENT_ID is not set" | Set it in `.env` and restart `npm run dev`. |
| Spotify shows "INVALID_CLIENT: Invalid redirect URI" | The redirect URI in the Spotify app does not match `.env`. Copy it from **Setup & Sync** step 1. |
| The login returns to an error | Open the app at `http://127.0.0.1:5173`, not `localhost`, and try again. |
| Every call fails with 403 | Add your account in **Settings › User Management** of the Spotify app. Check that your Premium is active. |
| "Spotify login expired. Log in again." | The 6-month login ended, or you removed the app's access. Click **Connect Spotify**. |
| Sync is slow or waits | Spotify limits the request rate. The app waits and retries by itself. Leave the page open or come back later. |
| A playlist shows no tracks | Spotify returns tracks only for Owned and collaborative playlists. If Spotify refused an Owned Playlist (403), the next sync after the playlist changes tries again. |
