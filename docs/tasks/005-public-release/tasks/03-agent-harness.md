# 03 — Agent harness and agent-neutral wording

## Goal

Make the propose-playlists workflow usable from Claude Code, Codex, Gemini CLI, Cursor and GitHub Copilot, with one source of truth and few files. Remove the vendor name from product UI text and docs outside the Proposals feature.

## What changed (files)

New:

- `AGENTS.md`: the project guide for every agent (what the tool is, stack and layout, commands, conventions, privacy rules, Workflows pointer).
- `CLAUDE.md`: only `@AGENTS.md`.
- `.agents/skills/propose-playlists/SKILL.md`: THE workflow (agentskills.io format). Moved from `.claude/commands/propose-playlists.md` and made vendor-neutral. It names the digest and track scripts and mentions Basic Proposals (generator `basic`).
- `.claude/skills/propose-playlists/SKILL.md`: thin Claude Code wrapper. It keeps the Claude-specific `argument-hint` and `allowed-tools`, says "Follow `.agents/skills/propose-playlists/SKILL.md` exactly", and passes `$ARGUMENTS` as the focus.
- `.gemini/settings.json`: `context.fileName: ["AGENTS.md", "GEMINI.md"]`.
- `.gemini/commands/propose-playlists.toml`: injects the shared SKILL.md with `@{...}` and passes `{{args}}` as the focus.

Removed: `.claude/commands/propose-playlists.md` (the skill replaces it; the `/propose-playlists` name stays).

Wording only:

- `SETUP.md`: prerequisites (any AI agent, optional; Basic Proposals without one), workflow diagram, step 4, data table, and a new "Use it with an AI agent" subsection with a per-agent table.
- `docs/adr/0001-claude-writes-proposals-offline.md`: one "Amended by ADR 0003" line. File name unchanged.
- `apps/web/src/pages/LibraryPage.tsx`, `apps/web/src/pages/home/steps.tsx`, `apps/web/src/pages/library/CoveragePanel.tsx`, `apps/web/src/pages/library/EnrichPanel.tsx`: "your AI agent" instead of "Claude"/"Claude Code"; no slash command in UI text.
- `apps/server/src/features/enrich/snapshot.ts` (comments), `snapshot-cli.ts` (final message), `packages/shared/src/snapshot.ts` (comment): "an Agent" / "your AI agent".

`CONTEXT.md` needed no change: its **Agent** entry names vendors only as examples.

## Decisions

- **No symlink for Claude Code.** Windows checks out symlinks as text files. A 10-line wrapper skill in `.claude/skills/` works everywhere. The wrapper holds the Claude-only frontmatter (`argument-hint`, `allowed-tools` with `Bash(...)` syntax), so the shared SKILL.md has only the spec fields `name` and `description`. Other clients never see unknown fields.
- **The shared skill does not use `$ARGUMENTS`.** It says "if the user gave a focus, respect it". Each wrapper passes the focus its own way (`$ARGUMENTS` in Claude Code, `{{args}}` in Gemini CLI).
- **`CLAUDE.md` imports `@AGENTS.md`.** Claude Code reads `AGENTS.md` natively only when no `CLAUDE.md` or `CLAUDE.local.md` exists; the import also covers older versions and contributors with a `CLAUDE.local.md`.
- **Gemini gets a TOML command.** Gemini CLI skills are not slash-invocable, so `/propose-playlists` needs the command. It injects the skill file, so the workflow text is not duplicated. `GEMINI.md` stays in `fileName` so a user's own `GEMINI.md` still loads.
- **Nothing for Codex, Cursor or Copilot.** They read `AGENTS.md` and `.agents/skills/` natively (research section 2). No `.cursor/`, `.github/copilot-instructions.md` or `.github/prompts/`.
- **UI text says "ask your AI agent to propose playlists"**, not `/propose-playlists`: the slash syntax differs per agent (`$propose-playlists` in Codex). SETUP.md lists the exact syntax per agent.
- **SETUP.md: a subsection, not a new numbered section**, so the section numbers (and other workstreams' edits) stay stable.
- **SKILL.md says "the schema wins"** over its JSON example, because workstream 1 may add a field (for example the generator) to `proposals.ts`.

## How to verify

1. `npm run typecheck` and `npx vitest run` pass.
2. `grep -rniI claude --exclude-dir={node_modules,data,.git,tasks,adr,.claude} --exclude={CLAUDE.md,AGENTS.md} .` shows only: vendor lists in `SETUP.md` and `CONTEXT.md`, plus files owned by others (README.md; the Proposals feature: `ProposalsPage.tsx`, `pages/proposals/**`, `features/proposals/**`, `packages/shared/src/proposals.ts`).
3. Claude Code: `/propose-playlists` appears in the slash menu with the argument hint; `/propose-playlists only 90s` reads the shared SKILL.md and respects the focus.
4. Gemini CLI: `/memory show` lists `AGENTS.md`; `/propose-playlists only 90s` shows the injected skill text.
5. Codex: `/skills` lists `propose-playlists`; `$propose-playlists` runs it.
6. Cursor / Copilot (VS Code): `/propose-playlists` appears in the agent chat.

## Parking lot

- Cursor and Copilot read both `.agents/skills/` and `.claude/skills/`, so they may list `propose-playlists` twice. Both copies lead to the same workflow (the wrapper points to the shared file), but the wrapper shows a literal `$ARGUMENTS`. Whether they deduplicate by name is unverified. If it confuses users, drop the wrapper's description or rename it.
- Aider needs `read: AGENTS.md` in `.aider.conf.yml`. Not added (not in the supported list).
- README.md still says `.claude/commands` and "Claude Code writes the Proposals". The main session rewrites README.
- The SKILL.md hand-over URL assumes the default port 5173. Update it if workstream 2 changes how ports are shown.
