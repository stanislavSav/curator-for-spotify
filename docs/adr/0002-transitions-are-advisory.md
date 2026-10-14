# Transitions are advisory: the app writes order, the user applies Mix by hand

Spotify Mix (transitions, Fade/Rise presets, EQ, bar length) has no Web API, Web Playback SDK or deep-link access as of 2026-10. The Web Playback SDK cannot crossfade DRM audio either. So the app controls only the track order of a DJ Set and outputs a Transition Sheet that the user applies in Spotify › Mix › Edit.

## Consequences

- After the user customises Transitions in Spotify, the app must not reorder or rewrite that playlist. A reorder can reset Transitions to Auto. A rebuild creates a new playlist instead.
- The user should not run Spotify's "Smart Reorder", because it replaces our order.
