# Proposals are written by any AI agent, with a rule-based fallback

Amends ADR 0001 for the public release. The proposal workflow is not tied to one vendor. It lives once in `.agents/skills/propose-playlists/SKILL.md`. `AGENTS.md` points every agent to it, and Claude Code and Gemini CLI get thin wrappers (a skill stub and a slash command). People without an AI agent can press "Generate basic proposals": the app then groups the Library by tags, tempo and era. These Proposals are plainer, but the review flow is the same.

## Considered options

- Agent-only: simplest, but the tool would be half-useful without an agent.
- In-app LLM API keys: more code, keys to manage, and vendor SDKs to maintain. Parked.
