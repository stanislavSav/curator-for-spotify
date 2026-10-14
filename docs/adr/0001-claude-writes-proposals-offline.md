# Claude Code writes Proposals from a file Snapshot; the app has no LLM key

**Amended by [ADR 0003](0003-agent-neutral-proposals.md):** any AI agent can write Proposals, and the app can build Basic Proposals without one.

The app does not call an LLM. It writes a Snapshot (`data/snapshot.json`). Claude Code reads the Snapshot in a session (`/propose-playlists`) and writes `data/proposals.json`. The web app only reviews, edits and applies Proposals. The user asked for this so they do not have to provide an API key and they keep the judgement work inside Claude Code. The cost: new Proposals need a Claude session, so they cannot be made from a button in the app.

## Considered options

- Anthropic SDK in the server with a user key (about $0.08–0.16 per run). Rejected by the user.
- Rules and clustering only. Worse names and groupings. Kept as the fallback input that the Snapshot already contains (tag and BPM statistics).
