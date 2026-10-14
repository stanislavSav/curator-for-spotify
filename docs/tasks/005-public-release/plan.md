# 005 — Public release on GitHub

**Status:** done (2026-10-14). Published at github.com/stanislavSav/spotify-curator; CI green; pull requests disabled.
**Started:** 2026-10-14
**Inputs:** `tasks/decisions-log.md`, `research/agent-harness-formats.md`, ADR 0003.

## Goal

Publish `spotify-curator` as a clean, public, MIT-licensed repo that a stranger can run in 10 minutes, with any popular AI agent, without any of the owner's personal data in it.

## Workstreams

| # | Workstream | Owner | Task file |
|---|------------|-------|-----------|
| 1 | Basic Proposals (rule-based fallback) and agent-neutral wording on the Proposals page | subagent | `tasks/01-basic-proposals.md` |
| 2 | Demo mode (`npm run demo`, fake library, Spotify writes blocked) | subagent | `tasks/02-demo-mode.md` |
| 3 | Agent harness (AGENTS.md, shared skill, Claude/Gemini wrappers) and agent-neutral wording everywhere else | subagent | `tasks/03-agent-harness.md` |
| 4 | Repo hygiene: LICENSE, CI, privacy guard + git hook, CONTRIBUTING (fork guide), docs scrub | subagent | `tasks/04-repo-hygiene.md` |
| 5 | README + screenshots, final privacy audit, git identity, first commit, create the repo, disable PRs | main session | `tasks/05-publish.md` |

## Exit criteria

- `npm run typecheck`, `npm test` and `npm run check:public` pass.
- A fresh clone + `npm install` + `npm run demo` shows a working app with fake data.
- `git log` shows only the user's GitHub identity, with no AI mention. The privacy scan of the whole tree and history is clean.
- Pull requests are disabled on GitHub.
