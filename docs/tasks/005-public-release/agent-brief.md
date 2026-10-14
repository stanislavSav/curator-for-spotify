# Brief for subagents (task 005, public release)

The app is finished and works. We are preparing it for a **public** GitHub repo. Four agents work at the same time in the same folder, each on one workstream.

## Read first

1. `docs/tasks/005-public-release/plan.md` and `tasks/decisions-log.md` — what the user decided.
2. `docs/tasks/005-public-release/research/agent-harness-formats.md` — agent file formats (workstream 3 must read it; others skim).
3. `/CONTEXT.md` — the glossary. New terms: **Agent**, **Basic Proposal**. `docs/adr/0003-agent-neutral-proposals.md`.
4. `docs/tasks/003-implementation/agent-brief.md` — code style rules. They still apply.

## Hard rules

- **Privacy.** `data/` holds the owner's real Spotify library (DB, snapshot, proposals, backups) and `.env` holds their Client ID. Never copy anything from `data/` or `.env` into any other file. Never quote the owner's tracks, playlists, artist counts or library numbers in docs, fixtures, tests or screenshots. Fixtures use fake ids and well-known public songs only.
- **No AI attribution** in any file meant as project metadata (package.json authors, LICENSE, CONTRIBUTING, credits). Naming supported agents (Claude Code, Codex, Gemini CLI, Cursor, Copilot) in docs is fine. Product UI text must say "your AI agent", not a vendor name.
- **Do not start the dev server on ports 5173/8787.** The owner's app is running there with real data. If you need a running app, use other ports (workstream 2 adds env-configurable ports).
- **Do not commit, push or change git config.** The main session does that.
- Change only the files your prompt lists (plus new files in your own folders). Foundation changes must be small, additive, and listed in your report.
- No new npm dependencies.
- Before you finish, run `npx vitest run` and `npm run typecheck` and fix your own errors.

## Deliverables

1. Code and docs.
2. `docs/tasks/005-public-release/tasks/<your file>.md` with these sections: Goal, What changed (files), Decisions (with why), How to verify, Parking lot.
3. A final report of at most 200 words.
