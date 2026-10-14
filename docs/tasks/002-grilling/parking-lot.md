# 002 — Parking lot

- Technical log import (`KmPageView.json`) as a "playlist opened" signal. The user skipped it; add it if they request that package later.
- Spotify's "Building with AI" page does not say whether the user's own data can be sent to an LLM for analysis. Our flow keeps the data local, and Claude Code reads it in the user's own session. Re-check if the terms change.
- Refresh tokens expire 6 months after login. The app must show a clear "log in again" state.
