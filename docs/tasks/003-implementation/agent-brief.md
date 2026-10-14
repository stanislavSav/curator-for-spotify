# Brief for implementation subagents (task 003, step 1)

You build ONE feature of the Spotify Curator app. Four other agents build other features at the same time in the same folder.

## Read first

1. `/CONTEXT.md` — the glossary. Use these words in code, UI text and docs.
2. `docs/adr/0001-*.md`, `docs/adr/0002-*.md`.
3. `docs/tasks/002-grilling/tasks/decisions-log.md` — what the user agreed.
4. `docs/tasks/003-implementation/plan.md` — architecture and who owns what.
5. The research file(s) named in your prompt (`docs/tasks/001-research/tasks/`).
6. The foundation code. Read these files before you write code:
   - `packages/shared/src/{domain,music,snapshot}.ts`
   - `apps/server/src/{app,config}.ts`, `db/db.ts` (full schema), `db/library.ts`, `spotify/auth.ts`, `spotify/client.ts`, `jobs/jobs.ts`
   - `apps/web/src/{App,api,main}.tsx|ts`, `components/ui.tsx`

## Rules

- **Change only the files you own.** Your prompt lists them. You may add new files inside your own folders.
- Foundation files belong to the main session. If you really need a change there, keep it small and additive (for example a new helper, or a new `CREATE TABLE IF NOT EXISTS` in `db.ts`). Never rename or remove anything. List every foundation change in your report.
- **Do not start the dev server** and do not bind ports 5173 or 8787. Other agents are working at the same time.
- **Do not add npm dependencies.** Available: hono, better-sqlite3, zod, fflate (server), react 19, @tanstack/react-query, tailwind v4 (web), vitest. If something is truly missing, say so in your report.
- Spotify calls go through `SpotifyClient` (`spotify()` or `new SpotifyClient(db, fakeFetch)` in tests). Use the post-Feb-2026 paths only (`/items`, `/me/playlists`, `/me/library`). No batch "get several" endpoints.
- Long work runs as a job (`startJob`). The UI polls it with `useJob`.
- Match the existing style: plain SQL with better-sqlite3, small typed functions, few comments (only for the "why"), Tailwind plus the `components/ui.tsx` primitives, a dark theme.
- Tests: Vitest, colocated as `*.test.ts`. Use `openDb(':memory:')` and an injected fake `fetch`. Never call real services in tests. Test the pure logic well (scoring, ordering, parsing, validation).
- Before you finish: `npx vitest run <your folder>` and `npm run typecheck`. Fix errors in your own files. Errors in another agent's files that are still being written may appear; ignore those and mention them.
- UI text: short, plain sentences. Every page explains what it does and what the user should do next.

## Deliverables

1. Working code and tests.
2. `docs/tasks/003-implementation/tasks/<your file>.md` with these sections: Goal, What was built (files), Decisions (with the reason for each), How to test manually, Known gaps, Parking lot.
3. A final report of at most 250 words: what works, any foundation changes, and open issues.
