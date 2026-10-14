# 05 — Publish (main session)

## Goal

Integrate the four workstreams, write the README, take screenshots from the demo, run a final privacy audit, and publish the repo.

## What changed

- `README.md` rewritten: what it does, a "Before you start" box (Premium, own Spotify app, Development Mode limits, no audio features or Mix API), demo, quick start, agent table, architecture, privacy (what each external service receives), commands, limitations, docs, fork-only contributing, licence.
- `docs/screenshots/*.png` taken from `npm run demo` (fake library) on side ports.
- `npm test` now runs Vitest and the privacy-guard tests; the CI duplicate step is removed.
- Enrich snapshot job message shows the real path (demo mode writes to `data/demo/`).
- Privacy guard: a marker that looks like a path (`/Users/x`) is now a literal, not a regex (regression test added).
- Sync test fixtures no longer use the owner's first name.

## Decisions

- Screenshots come only from demo data, so no real track or playlist can leak.
- A local, git-ignored `.private-markers` holds the owner's real identifiers; the pre-commit hook and `check:public` block them.
- Git identity is repo-local: GitHub handle + noreply address; there is no AI trailer.

## How to verify

`npm run check:public && npm run typecheck && npm test && npm run build`, then `git log --format='%an <%ae>%n%B'`.
