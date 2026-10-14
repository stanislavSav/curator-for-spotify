# Forking guide

This repo does **not accept pull requests**. Pull requests are turned off in the repository settings. To change the app, fork it and make it your own. The MIT licence (`LICENSE`) allows this.

You can still report bugs. See [Report a bug](#report-a-bug).

## Fork and run

1. Fork the repo on GitHub, then clone your fork.
2. Use Node 22 (`.nvmrc`; `nvm use` picks it up).
3. Run `npm install`. This also turns on the git hooks (see [Privacy guard](#privacy-guard)).
4. Try it with fake data: `npm run demo`.
5. Use it with your own library: follow [SETUP.md](SETUP.md) (Spotify app, `.env`, connect, sync).

## Project layout

| Path | What it holds |
|------|---------------|
| `apps/server` | Hono API on Node 22, SQLite (better-sqlite3). One folder per feature in `src/features/` (sync, enrich, proposals, prune, dj). |
| `apps/web` | Vite + React web app. One page per feature in `src/pages/`. |
| `packages/shared` | Domain types and the Snapshot contract, shared by server and web. |
| `AGENTS.md`, `.agents/skills/` | Instructions for AI agents, and the shared skill that writes Proposals. |
| `scripts/` | Repo scripts: demo, privacy guard, hook installer. |
| `data/` | Your library, Snapshot, Proposals and Backups. Git-ignored. Never commit it. |
| `docs/` | ADRs and task history (see below). |
| `CONTEXT.md` | The glossary. |

## Checks

| Command | What it does |
|---------|--------------|
| `npm run typecheck` | TypeScript for shared, server and web. |
| `npm test` | Vitest. Tests sit next to the code (`*.test.ts`). They use an in-memory DB and an injected `fetch`, never the real Spotify API. |
| `npm run build` | Builds the web app. |
| `npm run check:public` | The privacy guard (see below). |
| `node --test "scripts/**/*.test.mjs"` | Tests for the privacy guard rules (`scripts/lib/`). They use `node:test`, because Vitest covers `apps/` and `packages/` only. |

CI (`.github/workflows/ci.yml`) runs all of them on each push to `main`. It runs in your fork too, if you turn on Actions there.

## How the docs work

Every larger change is a numbered task folder in `docs/tasks/`:

- `plan.md`: the goal, the workstreams and the exit criteria.
- `tasks/*.md`: one file per workstream: what changed, decisions with the reason, how to verify.
- `tasks/decisions-log.md`: the questions asked and the answers, batch by batch.
- `parking-lot.md`: good ideas that are out of scope for now.

Hard-to-reverse decisions are ADRs in `docs/adr/` (`NNNN-short-title.md`). Domain words (Library, Snapshot, Proposal, Prune Candidate, DJ Set, …) are defined in `CONTEXT.md`. Use them the same way in code, UI and docs.

If you keep this workflow in your fork, start your first task at the next free number.

## Privacy guard

Your real library must never reach a public repo. `scripts/check-public.mjs` checks every file that git would publish (tracked and untracked, but not ignored). It fails when a file:

- is in `data/`, or is a database, Snapshot, Proposals, Backup, `.env`, key or Spotify export file;
- holds something that looks like a secret: a Spotify Client ID assigned in an env-style line, a private key block, a Spotify access token, or an API key, secret, token or password with a long literal value;
- holds one of your **personal markers**.

Personal markers: copy `.private-markers.example` to `.private-markers` (git-ignored) and add your name, email, playlist names, library size, and so on. Plain lines are matched as text, case-insensitive. Lines like `/pattern/flags` are regexes. Use `\b` around numbers.

`npm install` sets `git config core.hooksPath .githooks`, so `.githooks/pre-commit` runs the guard on the staged files before each commit. It does not change the setting when you already use another hooks folder, in CI, or outside a git repo. To turn it on by hand: `git config core.hooksPath .githooks`.

When a match is intentional, add the text `check-public-ignore` to that line. The guard does not look inside binary files: check screenshots yourself before you commit them.

## Report a bug

Open an issue on the original repo. Include:

- what you did, what you expected, and what happened;
- your OS and Node version, and whether it happens in `npm run demo`;
- the server log lines around the error.

Do not paste your `.env`, tokens, or files from `data/` into an issue.
