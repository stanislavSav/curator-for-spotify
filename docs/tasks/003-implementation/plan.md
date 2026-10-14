# 003 — Implementation: local Spotify Curator app

**Status:** steps 0–2 done (2026-10-13); step 3 waits for the user's Spotify Client ID
**Started:** 2026-10-13
**Inputs:** `/CONTEXT.md`, `docs/adr/0001`, `docs/adr/0002`, `docs/tasks/002-grilling/tasks/decisions-log.md`, research in `docs/tasks/001-research/tasks/`.

## Architecture

```
apps/web     Vite + React 19 + TanStack Query + Tailwind v4   http://127.0.0.1:5173  (proxies /api, /auth)
apps/server  Hono on Node 22 + better-sqlite3 (data/curator.sqlite)  http://127.0.0.1:8787
packages/shared  domain types, Camelot helpers, Snapshot contract
data/        sqlite DB, snapshot.json, proposals.json, backups/  (git-ignored)
.claude/commands/propose-playlists.md   Claude Code writes data/proposals.json
```

Flow: **Connect** (PKCE) → **Sync** → **Enrich** (ReccoBeats / Deezer / tags) → **Snapshot** → Claude `/propose-playlists` → **Proposals** review → create on Spotify. In parallel: **Prune** (import Streaming History → evidence → confirm → backup → remove) and **DJ Set** (Pool → order by BPM/key/Energy Curve → Transition Sheet → create).

## Step 0 — Foundation (done by the main session)

- npm workspaces monorepo, TS 6, Vitest. One command: `npm run dev`.
- `apps/server`: DB schema for every feature (`db/db.ts`), `db/library.ts` (LibraryTrack join), PKCE auth with token refresh and a 6-month re-login date (`spotify/auth.ts`), Spotify client with a serial queue, 429/401/5xx handling and write helpers (`spotify/client.ts`), background jobs (`jobs/jobs.ts`), and feature routers mounted under `/api/<feature>`.
- `apps/web`: hash-routed shell with 5 pages, `api.ts` (fetch + job polling hooks), `components/ui.tsx`.
- `packages/shared`: `domain.ts`, `music.ts` (Camelot), `snapshot.ts`.

## Step 1 — Feature workstreams (5 parallel subagents)

| # | Workstream | Owns | Task file |
|---|------------|------|-----------|
| 1 | Sync + Setup page + SETUP/README | `features/sync/`, `HomePage.tsx`, `shared/sync.ts`, `SETUP.md`, `README.md` | `tasks/01-sync.md` |
| 2 | Enrich + Snapshot + Library page | `features/enrich/`, `LibraryPage.tsx`, `shared/library.ts` | `tasks/02-enrich-snapshot.md` |
| 3 | Prune (history import, evidence, backup, remove, restore) | `features/prune/`, `PrunePage.tsx`, `shared/prune.ts` | `tasks/03-prune.md` |
| 4 | DJ Set (pool, ordering, Transition Sheet, create) | `features/dj/`, `DjPage.tsx`, `shared/dj.ts` | `tasks/04-dj-set.md` |
| 5 | Proposals (schema, review/edit, apply, `/propose-playlists`) | `features/proposals/`, `ProposalsPage.tsx`, `shared/proposals.ts`, `.claude/commands/` | `tasks/05-proposals.md` |

Rules: each agent changes only its own files. Foundation changes must be additive and reported. No dev server during parallel work. Tests use Vitest with an in-memory DB and an injected `fetch`.

## Step 2 — Integration (main session)

Typecheck, run all tests, boot the app, click through each page in the browser, fix any seams between features, and update the docs.

## Step 3 — First real run (with the user)

Create the Spotify app → `.env` → connect → sync → enrich → snapshot → Claude writes proposals → review.
