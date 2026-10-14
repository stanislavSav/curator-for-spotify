# The DJ AI pass runs the user's own agent CLI, headless and tool-less

The "✦ AI pass" button needs an LLM, but ADR 0003 keeps API keys out of the app. So the server spawns the agent CLI the user already has installed and logged in (`claude`, `codex` or `gemini`; `AGENT_CLI` picks one). It runs in an empty temporary folder, with tools disabled where the CLI allows it. The set goes in as text on stdin, and only a JSON answer is read back from stdout. The server validates every value against Spotify's option lists and keeps the rule version for anything invalid. The AI only advises: its values show as "AI" badges that the user can keep or reset.

## Considered options

- Hand-off file plus a slash command: works with any agent, but takes two steps. It remains the fallback when no CLI is installed.
- LLM API key in `.env`: rejected in ADR 0003.

## Consequences

- Track names, artists and audio features of the set are sent to the agent's provider, as when the user runs `/propose-playlists`. The README privacy section says so.
- CLI flags change between versions. The runner keeps them in one table, with a test per CLI.
