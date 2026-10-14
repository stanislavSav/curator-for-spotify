# Decisions log — public release

## Batch 1 — repo basics and privacy (2026-10-14)

| Question | Answer | Consequence |
|----------|--------|-------------|
| Commit author | No real email; the personal GitHub account | Repo-local git config: the user's GitHub name and GitHub **noreply** address. Git needs an email field; noreply is not a real inbox and links commits to the profile. |
| docs/tasks history | Publish, scrubbed | Keep research, ADRs, glossary and task history. Remove personal details (library numbers, account setup, quotes). |
| Name, licence, visibility | `spotify-curator`, MIT, public | Create the repo with `gh` after the user approves the final diff. |
| Agents with a harness | Claude Code, OpenAI Codex, Gemini CLI, Cursor + Copilot | One `AGENTS.md` plus one shared skill; thin wrappers only where an agent needs them (see research/agent-harness-formats.md). |

## Batch 2 — proposals for other people (asked on its own)

| Question | Answer | Consequence |
|----------|--------|-------------|
| How do other people get Proposals? | Any agent, plus a rule-based fallback | The workflow is agent-agnostic. The UI says "your AI agent". A "Generate basic proposals" button builds simple Proposals without any agent. See ADR 0003. |

## Batch 3 — extras

| Question | Answer | Consequence |
|----------|--------|-------------|
| Demo mode | `npm run demo` + screenshots | Seeds a fake library into `data/demo/`. README screenshots come from it. Spotify writes are disabled in demo mode. |
| Extras | CI, privacy guard, CONTRIBUTING; no pull requests (fork to customise) | GitHub Actions (typecheck + tests + privacy check), a pre-commit privacy guard, CONTRIBUTING.md written as a *forking* guide. Pull requests disabled in the repo settings (GitHub feature since 2026-02). No PR template. |
| Spotify limits in README | Up-front "Before you start" box | Premium, own Spotify app, ≤5 users, no audio features or Mix API. |

## Constraints from the user (all batches)

- Commits and contributors must not mention Claude: no `Co-Authored-By` trailer and no AI attribution in messages.
- No personal data in the repo: no songs, playlists, snapshot, proposals, DB, backups, `.env`, Client ID, email or library statistics.
