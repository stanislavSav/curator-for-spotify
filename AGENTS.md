# Curator for Spotify

A local web app for one Spotify account. It syncs the user's Library into SQLite, enriches tracks with BPM, key, energy and tags from third-party sources, and writes a compact Snapshot (`data/snapshot.json`). An Agent (you) reads the Snapshot and writes playlist Proposals to `data/proposals.json`; the user reviews them in the app, which creates the approved playlists on Spotify. The app also prunes unused playlists (with a Backup first) and builds DJ Sets ordered by BPM, Camelot key and energy. The app has no LLM key; see `docs/adr/0001-claude-writes-proposals-offline.md` and `docs/adr/0003-agent-neutral-proposals.md`.

## Stack and layout

TypeScript monorepo with npm workspaces. Node 22.12 or later.

```
apps/web         Vite + React 19 + TanStack Query + Tailwind v4 (http://127.0.0.1:5173, proxies /api and /auth)
apps/server      Hono on Node + better-sqlite3 (http://127.0.0.1:8787)
  src/spotify/   PKCE login, token refresh, Web API client (serial queue, 429 retry)
  src/db/        one SQLite schema for all features
  src/jobs/      background jobs that the web app polls
  src/features/  sync, enrich, prune, dj, proposals (one folder per feature)
packages/shared  types shared by server and web, Camelot helpers, Snapshot and Proposal contracts (zod)
data/            the user's real data: DB, Snapshot, Proposals, Backups (git-ignored)
docs/adr/        architecture decisions
docs/tasks/      research, plans and implementation notes, one folder per task
.agents/skills/  shared Agent workflows (one source of truth)
```

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | Starts the server and the web app. |
| `npm run demo` | Starts the app with a fake Library in a separate data folder. Spotify writes are blocked. |
| `npm test` | Runs all Vitest tests and the privacy-guard tests (`npx vitest run <path>` for one folder). |
| `npm run typecheck` | Type-checks `packages/shared`, `apps/server` and `apps/web`. |
| `npm run check:public` | Scans the tree for personal data before a commit. |
| `npm run snapshot` | Writes `data/snapshot.json` from the command line. |
| `npm run validate-proposals` | Checks `data/proposals.json` against the Proposal schema and the local DB. |

Before you finish a code change, run `npm run typecheck` and `npm test`.

## Conventions

- **Glossary.** `CONTEXT.md` defines the domain terms (Library, Owned Playlist, Snapshot, Agent, Proposal, Basic Proposal, Prune Candidate, DJ Set, and more). Use these words in code, UI text and docs. Do not use the "Avoid" words.
- **ADRs.** Record a hard-to-reverse decision in `docs/adr/NNNN-<slug>.md`: a short title, the decision and its reason, then "Considered options". Amend an old ADR with a new one; do not rewrite it.
- **Tasks.** Bigger work gets a folder `docs/tasks/NNN-<slug>/` with `plan.md` (goal, workstreams, exit criteria), `parking-lot.md` (ideas that are out of scope), `research/` when needed, and `tasks/` (a decisions log plus one file per workstream: Goal, What changed, Decisions, How to verify, Parking lot).
- **Code style.** Small typed functions, plain SQL with better-sqlite3, few comments (only for the "why"). Long work runs as a job. Tests are colocated `*.test.ts` files; use `openDb(':memory:')` and an injected fake `fetch`, never real services.
- **Spotify API.** All calls go through `SpotifyClient`. Use only the endpoints that remain after February 2026 (`/me/playlists`, `/playlists/{id}/items`, `/me/library`). No batch "get several" endpoints.
- **UI text.** Short, plain sentences. Each page says what it does and what to do next. Say "your AI agent", never a vendor name.
- No new npm dependencies without asking the user.

## Privacy

- `data/` holds the user's real Spotify library. **Do not read anything in `data/`** unless the user asks for the propose-playlists workflow, or asks you to look at their data.
- Never copy content from `data/` or `.env` into another file: no track names, playlist names, ids, counts or library statistics in code, tests, fixtures, docs or commit messages. Fixtures use fake ids and well-known public songs.
- Never commit `data/` or `.env`. Run `npm run check:public` before a commit.
- Do not start a second dev server on ports 5173 or 8787 if the user's app already runs there.

## Workflows

- **Propose playlists.** When the user asks to propose playlists (new playlist ideas, Proposals), follow `.agents/skills/propose-playlists/SKILL.md` exactly. If the user gave a focus (for example "only 90s"), respect it.
