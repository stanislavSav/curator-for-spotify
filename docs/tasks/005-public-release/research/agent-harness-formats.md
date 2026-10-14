# Agent harness formats (research, 2026-10-14)

Goal: make the "propose playlists" workflow usable from the most popular coding agents, with a minimal harness and one source of truth.

Today the workflow is a Claude Code command: `.claude/commands/propose-playlists.md`.

Items marked **UNVERIFIED** do not have a primary source.

## 1. Project instructions: AGENTS.md

### Who reads AGENTS.md natively

The agents.md site lists these tools: Codex, Jules, Factory, Aider, goose, opencode, Zed, Warp, VS Code, Devin, UiPath, Junie, Amp, Cursor, RooCode, Gemini CLI, Kilo Code, Phoenix, Semgrep, GitHub Copilot coding agent, Ona, Windsurf, Augment Code.
Source: https://agents.md/

Notes per agent:

- **OpenAI Codex**: native. It walks from the Git root down to the current directory. In each directory it reads `AGENTS.override.md`, then `AGENTS.md`, then names in `project_doc_fallback_filenames`. The combined limit is 32 KiB (`project_doc_max_bytes`). Source: https://learn.chatgpt.com/docs/agent-configuration/agents-md
- **Cursor**: native, root and subdirectories. Source: https://cursor.com/docs/context/rules
- **GitHub Copilot**: the cloud (coding) agent reads root and nested `AGENTS.md`, plus `.github/copilot-instructions.md`, `.github/instructions/**/*.instructions.md`, `CLAUDE.md` and `GEMINI.md` (changelog 2025-08-28). Copilot CLI reads `AGENTS.md`. Copilot code review reads "agent instructions" from the head branch. Sources: https://github.blog/changelog/2025-08-28-copilot-coding-agent-now-supports-agents-md-custom-instructions , https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli , https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions
- **Gemini CLI**: NOT by default. The default context file is `GEMINI.md`. Set `context.fileName` in `.gemini/settings.json` to read `AGENTS.md`. The docs show the array form: `{"context": {"fileName": ["AGENTS.md", "GEMINI.md"]}}`. Source: https://geminicli.com/docs/cli/gemini-md/ (also https://agents.md/)
- **Aider**: needs `read: AGENTS.md` in `.aider.conf.yml`. Source: https://agents.md/
- **Claude Code**: native since v2.1.277, with conditions (see below).

### Claude Code and AGENTS.md

Claude Code now reads `AGENTS.md` through a built-in plugin (`cc-plugin-agents-md@builtin`). Source: https://code.claude.com/docs/en/memory#agents-md

- Default mode is `claude-md-or-agents-md`. Claude reads `AGENTS.md` only when there is no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` in the working directory or above it.
- If a `CLAUDE.md` exists, Claude reads only `CLAUDE.md`, unless `CLAUDE.md` imports `@AGENTS.md`.
- A `CLAUDE.md` that contains `@AGENTS.md` is still supported and is the documented way to "share one file with other coding tools". The import never loads `AGENTS.md` twice.
- Some sessions can not read `AGENTS.md` directly (plugin disabled, first session after an upgrade from v2.1.276 or earlier, older versions on Bedrock or with telemetry off). The docs say to use the `@AGENTS.md` import in those cases.
- Claude Code does not read `AGENTS.local.md`, `AGENTS.override.md`, or anything under `.agents/`.

Conclusion: a `CLAUDE.md` with `@AGENTS.md` is optional but robust. It covers older Claude Code versions and contributors who add their own `CLAUDE.local.md`. (A `CLAUDE.local.md` alone stops Claude from reading `AGENTS.md`.)

## 2. Reusable workflows (commands and skills)

### Agent Skills standard (agentskills.io)

- A skill is a folder with a `SKILL.md`. Frontmatter needs `name` and `description`. Optional: `license`, `compatibility`, `metadata`, `allowed-tools` (experimental).
- `name`: lowercase letters, digits and hyphens, max 64 characters. It must match the folder name.
- `description`: max 1024 characters. Say what the skill does and when to use it.
- Keep `SKILL.md` under 500 lines. Put long references in `references/`.
- The spec itself does NOT define a discovery folder. Each client picks its own folders.
- Clients listed on the site include Claude Code, Codex, Gemini CLI, Cursor, GitHub Copilot, VS Code, Amp, OpenCode, Goose, Junie, Factory, Roo Code, Kiro, and many more.
Sources: https://agentskills.io/ , https://agentskills.io/specification

### Skill folders per agent (repo level)

| Agent | Reads `.agents/skills/` | Reads `.claude/skills/` | Own folder | Explicit invocation |
| :- | :- | :- | :- | :- |
| Claude Code | No | Yes | `.claude/skills/` | `/name` |
| Codex (CLI, IDE) | Yes (cwd up to repo root) | No | none (`.agents/skills`) | `$name` or `/skills` |
| Gemini CLI | Yes (wins over `.gemini/skills` in the same tier) | No | `.gemini/skills/` | none; model calls `activate_skill` |
| Cursor | Yes | Yes (compatibility; also `.codex/skills`) | `.cursor/skills/` | `/name` |
| GitHub Copilot (cloud agent, CLI, code review, VS Code) | Yes | Yes | `.github/skills/` | `/name` in VS Code chat |

Sources:
- Claude Code: https://code.claude.com/docs/en/skills (no mention of `.agents`); https://code.claude.com/docs/en/memory ("Not read: ... anything under a `.agents/` directory").
- Codex: https://learn.chatgpt.com/docs/build-skills (was developers.openai.com/codex/skills).
- Gemini CLI: https://geminicli.com/docs/cli/skills/
- Cursor: https://cursor.com/docs/context/skills
- Copilot: https://docs.github.com/en/copilot/concepts/agents/about-agent-skills , https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/add-skills , https://code.visualstudio.com/docs/copilot/customization/agent-skills

So `.agents/skills/` is the de-facto cross-agent folder (Codex, Gemini CLI, Cursor, Copilot). Claude Code is the exception. It needs `.claude/skills/`.

Claude Code follows a symlinked skill folder: "a `<skill-name>` entry in the ... project location can be a symlink to a directory elsewhere on disk". It loads the skill once even if several locations point to the same target. Source: https://code.claude.com/docs/en/skills

### Claude Code: commands vs skills

- "Custom commands have been merged into skills." `.claude/commands/x.md` and `.claude/skills/x/SKILL.md` both create `/x`. Old command files keep working.
- The docs say: prefer a skill for new work.
- Same frontmatter, plus `name`. Useful fields: `description`, `argument-hint`, `allowed-tools`, `disable-model-invocation`.
- `$ARGUMENTS` expands to the typed arguments. If the body has no placeholder, Claude Code appends `ARGUMENTS: <value>` at the end. So a portable skill can omit `$ARGUMENTS`.
Source: https://code.claude.com/docs/en/skills

### Codex: custom prompts

- "Custom prompts are deprecated." Use skills.
- Custom prompts live only in `~/.codex/prompts/`. There is no repo-level location.
- A third-party blog says the prompts subsystem was removed in v0.117.0 (March 2026). **UNVERIFIED** against OpenAI release notes.
Source: https://learn.chatgpt.com/docs/custom-prompts

### Gemini CLI: custom commands

- Project commands: `.gemini/commands/<name>.toml`. User commands: `~/.gemini/commands/`.
- Fields: `prompt` (required), `description` (optional).
- `{{args}}` is replaced with the text after the command.
- `!{...}` runs a shell command and injects its output (asks for confirmation).
- `@{path}` injects a file's content into the prompt.
- Commands and skills are separate features. Skills are not slash-invocable in Gemini CLI. A thin command is the only way to get `/propose-playlists` there.
Sources: https://geminicli.com/docs/cli/custom-commands/ , https://geminicli.com/docs/cli/skills/

### Cursor: rules and commands

- `.cursor/rules/*.mdc` with frontmatter `description`, `globs`, `alwaysApply`. Plain `.md` in that folder is ignored. Not needed if `AGENTS.md` exists.
- `.cursor/commands/*.md`: the current docs no longer document this folder. Cursor ships a `/migrate-to-skills` skill that converts commands to skills with `disable-model-invocation: true`. Commands look legacy. Whether they still load is **UNVERIFIED**.
Sources: https://cursor.com/docs/context/rules , https://cursor.com/docs/context/skills

### GitHub Copilot: instructions and prompt files

- `.github/copilot-instructions.md`: repo-wide instructions. Not needed if `AGENTS.md` exists.
- `.github/prompts/*.prompt.md`: VS Code prompt files. They show in the `/` menu next to skills. Not needed if a skill exists.
- Skills cover cloud agent, CLI, code review and VS Code agent mode.
Sources: https://docs.github.com/en/copilot/how-tos/configure-custom-instructions/add-repository-instructions , https://code.visualstudio.com/docs/copilot/customization/agent-skills

## 3. Recommended minimal file set

One source of truth: `.agents/skills/propose-playlists/SKILL.md`. Everything else is a pointer.

```
AGENTS.md                                   # project instructions (all agents)
CLAUDE.md                                   # optional: "@AGENTS.md" only
.agents/skills/propose-playlists/SKILL.md   # THE workflow (Codex, Gemini, Cursor, Copilot)
.claude/skills/propose-playlists -> ../../.agents/skills/propose-playlists   # symlink (Claude Code)
.gemini/settings.json                       # make Gemini read AGENTS.md
.gemini/commands/propose-playlists.toml     # optional: /propose-playlists in Gemini
```

Delete `.claude/commands/propose-playlists.md` (the skill replaces it, same `/propose-playlists` name).

No `.cursor/`, no `.github/copilot-instructions.md`, no `.github/prompts/`. Cursor and Copilot read `AGENTS.md` and `.agents/skills/` natively.

### AGENTS.md

```markdown
# Spotify Curator

Local Spotify tool. TypeScript monorepo (apps/, packages/). Glossary: CONTEXT.md.

## Commands
- `npm run dev` – start the app
- `npm test` – run tests
- `npm run validate-proposals` – check data/proposals.json

## Workflows
- Propose playlists: follow `.agents/skills/propose-playlists/SKILL.md`.
  Use it when the user asks for new playlist ideas or Proposals.
```

The pointer line makes the workflow reachable by any agent that reads `AGENTS.md` but does not support skills, and by Claude Code if the symlink is missing.

### CLAUDE.md (optional)

```markdown
@AGENTS.md
```

### .agents/skills/propose-playlists/SKILL.md

```markdown
---
name: propose-playlists
description: Read data/snapshot.json and write new playlist Proposals to data/proposals.json for review in the app. Use when the user asks for playlist ideas or Proposals.
argument-hint: "[optional focus, e.g. 'more running playlists']"
allowed-tools: Read Write(data/proposals.json) Edit(data/proposals.json) Bash(npx tsx apps/server/src/features/proposals/scripts/:*) Bash(npm run validate-proposals:*)
---

# Propose playlists

If the user gave a focus (for example "only 90s"), apply it.

1. Run `npx tsx apps/server/src/features/proposals/scripts/digest.ts`. Stop on `No Snapshot`.
2. Do not read data/snapshot.json whole. Use the digest and the track lister.
3. Write data/proposals.json.
4. Run `npm run validate-proposals`. Fix errors until it passes.
```

Portability notes for the body:

- Do not use `$ARGUMENTS`. Only Claude Code expands it. Claude Code appends `ARGUMENTS: ...` by itself when there is no placeholder.
- Do not say "run `/propose-playlists`" in user-facing text. Say "ask your agent to propose playlists". The slash syntax is `$propose-playlists` in Codex.
- `argument-hint` is Claude Code / Cursor specific. `allowed-tools` is experimental in the spec, and the `Bash(...)` syntax is Claude Code's. Other clients should ignore unknown or unsupported fields. **UNVERIFIED** for every client; if a client rejects the file, drop these two fields.

### .claude/skills symlink

```sh
mkdir -p .claude/skills
ln -s ../../.agents/skills/propose-playlists .claude/skills/propose-playlists
```

Risk: on Windows, Git checks out symlinks as plain text files unless `core.symlinks=true` and Developer Mode are on. Then Claude Code does not see the skill, but still finds the workflow through the `AGENTS.md` pointer. (General Git behaviour; not from the agent docs.)

Risk: Cursor and Copilot read both `.agents/skills/` and `.claude/skills/`. They can see the same skill twice. Whether they deduplicate by name or target is **UNVERIFIED**. Claude Code deduplicates symlinks (documented).

Alternative without a symlink: keep the real folder only in `.claude/skills/` (Claude, Cursor, Copilot), and rely on the `AGENTS.md` pointer for Codex and Gemini. Cost: no `$propose-playlists` in Codex and no skill activation in Gemini.

### .gemini/settings.json

```json
{ "context": { "fileName": ["AGENTS.md", "GEMINI.md"] } }
```

### .gemini/commands/propose-playlists.toml (optional)

```toml
description = "Propose new playlists from data/snapshot.json"
prompt = """
Follow these instructions exactly:
@{.agents/skills/propose-playlists/SKILL.md}

User focus (may be empty): {{args}}
"""
```

It injects the skill file, so the workflow text is not duplicated.

## How each agent gets the workflow

| Agent | Instructions | Workflow | User types |
| :- | :- | :- | :- |
| Claude Code | `AGENTS.md` (native) or `CLAUDE.md` -> `@AGENTS.md` | `.claude/skills` symlink | `/propose-playlists` |
| Codex | `AGENTS.md` | `.agents/skills` | `$propose-playlists` or plain request |
| Gemini CLI | `AGENTS.md` via settings | `.agents/skills` (auto) and TOML command | `/propose-playlists` or plain request |
| Cursor | `AGENTS.md` | `.agents/skills` | `/propose-playlists` |
| Copilot | `AGENTS.md` | `.agents/skills` | `/propose-playlists` (VS Code) or plain request |
