# 004 — Parking lot

- Look up the tracks that ReccoBeats does not know through ReccoBeats' ISRC lookup, if it has one.
- Let a "Missing BPM" row link straight to the table filter.
- Start Enrich automatically after Sync (opt-in).
- Last.fm `artist.getTopTags` (free API key, ~5 req/s, strong coverage of niche electronic artists, includes mood tags). Would cover most of the artists that MusicBrainz knows but has no tags for. Waiting for the user's decision.
- MusicBrainz release-group genres for artists with no artist-level tags (one batched search per 100 release groups).
