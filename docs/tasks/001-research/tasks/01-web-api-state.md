# 01 - State of the Spotify Web API for a personal dev-mode app (October 2026)

Research date: 2026-10-13.
Scope: a local, single-user web app (React/TS, optional Node backend) on the owner's own Spotify account.
Primary sources are developer.spotify.com pages, the Spotify developer blog, and the GitHub SDK repository.
Items marked **UNVERIFIED** could not be confirmed from a primary source.

## Timeline of relevant changes

| Date | Change | Source |
|---|---|---|
| 2024-11-27 | Audio features, audio analysis, recommendations, related artists, featured and category playlists, preview URLs in multi-get, and algorithmic/editorial playlists are no longer available to new apps and dev-mode apps. | [Blog 2024-11-27](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api) |
| 2025-02-12 | Announcement of stricter OAuth rules (no implicit grant, no `localhost`, HTTPS except loopback IP). Enforced for new apps from 2025-04-09. | [Blog 2025-02-12](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify) |
| 2025-05-15 | Extended quota is only for organizations (registered business, 250k+ MAU). Developer Terms forbid training ML models on Spotify data. | [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) |
| 2025-11-27 | OAuth migration deadline for all apps: implicit grant, HTTP redirect URIs (non-loopback) and `localhost` stop working. | [Blog 2025-10-14 reminder](https://developer.spotify.com/blog/2025-10-14-reminder-oauth-migration-27-nov-2025) |
| 2026-02-06 | Announcement: Development Mode narrowed (Premium owner, 1 Client ID, 5 users, smaller endpoint set). | [Blog 2026-02-06](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) |
| 2026-02-11 | New dev-mode apps get the new restrictions and the reduced endpoint set. | [Migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Changelog Feb 2026](https://developer.spotify.com/documentation/web-api/references/changes/february-2026) |
| 2026-03-09 | Existing dev-mode apps get Premium/5-user/1-Client-ID rules. Spotify **postponed** the endpoint changes for existing apps (blog update). | [Blog 2026-02-06 (updated 03-09)](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) |
| 2026-03 | `external_ids` on tracks and albums reinstated. | [Changelog Mar 2026](https://developer.spotify.com/documentation/web-api/references/changes/march-2026) |
| 2026-05 | `account_id` added to the User object (stable ID). | [Changelog May 2026](https://developer.spotify.com/documentation/web-api/references/changes/may-2026) |
| 2026-06-18 | Refresh tokens expire 6 months after authorization (new apps). Existing apps from 2026-07-20. | [Blog 2026-06-18](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration), [Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens) |
| 2026-07-23 | Client ID cap raised from 1 to 25 per developer. Dev-mode quota counted per developer account (shared by all Client IDs). 429 can carry `reason: QUOTA_EXCEEDED`. | [Blog 2026-07-23](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates), [Changelog Jul 2026](https://developer.spotify.com/documentation/web-api/references/changes/july-2026) |

No changelog entries after July 2026 were found (checked 2026-10-13).

---

## 1. Development Mode rules now

Current rules (from the quota-modes page, blog posts and changelogs):

- **Premium:** the app owner must have an active Spotify Premium subscription. If Premium lapses, the app stops working until the owner resubscribes. In force for new apps since 2026-02-11, for existing apps since 2026-03-09.
- **Users:** up to **5** authenticated users per app. Each must be on the allowlist (Dashboard > app > Settings > Users Management). Non-allowlisted users can log in, but their API calls return 403.
- **Client IDs:** was 1 per developer (2026-02-11). Raised to **25 per developer account** on 2026-07-23.
- **Quota:** dev-mode quota is a **shared budget per developer account** since 2026-07-23. All your dev-mode Client IDs draw from the same bucket. No numbers are published.
- **Endpoint set:** new dev-mode apps can only use a reduced endpoint set (see item 2).
- **Purpose:** Spotify says dev mode is for learning, experimentation and personal, non-commercial projects.
- **Grandfathering:** existing apps keep extra Client IDs and users they already had.
- **Extended quota:** since 2025-05-15, only organizations can apply. Requirements: legally registered business, launched service, at least 250k MAU, available in key markets, commercial viability. Review takes up to 6 weeks. An individual cannot get it.

Open point: the blog says endpoint changes for **existing** (pre-2026-02-11) dev-mode apps were postponed on 2026-03-09 with no new date. The migration guide still says 2026-03-09. Developer reports (for example the comment on [spotify-web-api-ts-sdk#159](https://github.com/spotify/spotify-web-api-ts-sdk/issues/159), August 2026) show `/playlists/{id}/tracks` returning 403 in dev mode. Whether an old app still has the old endpoints is **UNVERIFIED**. A new app definitely gets the restricted set.

Sources:
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes
- https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security
- https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide

**Verdict:** A personal app is still possible. The owner needs Premium. Plan for 1 user (you), max 5. Extended quota is not reachable for an individual. Build the app against the post-February-2026 endpoint set.

---

## 2. Deprecated / removed endpoints and fields

### 2a. November 2024 removals (new apps and dev-mode apps since 2024-11-27)

Source: https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

| Endpoint / feature | Path | Status for a new dev-mode app |
|---|---|---|
| Audio Features | `GET /audio-features`, `GET /audio-features/{id}` | Not available (403). Reference page marked "Deprecated". |
| Audio Analysis | `GET /audio-analysis/{id}` | Not available. |
| Recommendations | `GET /recommendations` | Not available. |
| Related Artists | `GET /artists/{id}/related-artists` | Not available. |
| Featured Playlists | `GET /browse/featured-playlists` | Not available. |
| Category's Playlists | `GET /browse/categories/{id}/playlists` | Not available. |
| 30 s preview URLs | `preview_url` in track objects | Not available (field deprecated, returns null). |
| Algorithmic / Spotify editorial playlists | e.g. Discover Weekly, Daily Mix, editorial playlist IDs | Not readable. |

Apps that had extended-quota access and used these endpoints before 2024-11-27 are unaffected. That does not apply to us.

**Consequence:** no BPM, key, energy, danceability, or other audio features from Spotify. A DJ-style ordering by tempo/key needs another data source.

### 2b. February 2026 removals (new dev-mode apps since 2026-02-11)

Source: https://developer.spotify.com/documentation/web-api/references/changes/february-2026 and the migration guide.

| Removed | Old path | Replacement |
|---|---|---|
| Get Several Tracks/Albums/Artists/Episodes/Shows/Audiobooks/Chapters | `GET /tracks?ids=`, `/albums`, `/artists`, `/episodes`, `/shows`, `/audiobooks`, `/chapters` | Fetch one by one: `GET /tracks/{id}` etc. |
| Get Available Markets | `GET /markets` | None |
| Get New Releases | `GET /browse/new-releases` | None |
| Browse Categories | `GET /browse/categories`, `GET /browse/categories/{id}` | None |
| Artist's Top Tracks | `GET /artists/{id}/top-tracks` | None |
| Get User's Profile | `GET /users/{id}` | `GET /me` (current user only) |
| Get User's Playlists | `GET /users/{id}/playlists` | `GET /me/playlists` |
| Create Playlist (for user) | `POST /users/{user_id}/playlists` | `POST /me/playlists` |
| Save/remove/check per type | `PUT/DELETE/GET .../contains` on `/me/tracks`, `/me/albums`, `/me/episodes`, `/me/shows`, `/me/audiobooks` | `PUT /me/library`, `DELETE /me/library`, `GET /me/library/contains` (Spotify URIs) |
| Follow/unfollow artists, users, playlists | `/me/following`, `/playlists/{id}/followers` (+ `/contains`) | `PUT/DELETE /me/library`, `GET /me/library/contains` |
| Playlist tracks | `GET/POST/PUT/DELETE /playlists/{id}/tracks` | `GET/POST/PUT/DELETE /playlists/{id}/items` |

Changed: `GET /search` `limit` max is now **10** (was 50), default **5** (was 20). `offset` max 1000.

### 2c. Removed / deprecated fields

| Object | Removed fields (Feb 2026) | Also marked "Deprecated" in reference |
|---|---|---|
| Track | `available_markets`, `linked_from`, `popularity` (`external_ids` reinstated March 2026) | `preview_url` |
| Album | `album_group`, `available_markets`, `label`, `popularity` (`external_ids` reinstated) | |
| Artist | `followers`, `popularity` | **`genres`** (marked Deprecated on Get Artist, Search and Top Items pages) |
| User (`GET /me`) | `country`, `email`, `explicit_content`, `followers`, `product` | |
| Show / Audiobook / Chapter | `available_markets`, `publisher` | |
| Playlist | `tracks` renamed to `items`; `tracks.tracks.track` -> `items.items.item` | `track` inside playlist item (use `item`) |

Artist `genres` is marked "Deprecated" with no date. Whether it still returns data for a new dev-mode app is **UNVERIFIED**. Assume it can be empty.

Playlist `items` content is returned only for playlists the user owns or collaborates on. Other playlists return metadata only.

**Verdict:** Do not use audio features, recommendations, related artists, artist top tracks, popularity, followers, preview URLs, or batch "get several" endpoints. Treat `genres` as unreliable. Use only the `/items` and `/me/library` endpoints.

---

## 3. Endpoints we need (new dev-mode app)

All paths are relative to `https://api.spotify.com/v1`.

| Need | Method + path | Scope(s) | Limits / notes | Works in dev mode? |
|---|---|---|---|---|
| Current user | `GET /me` | none for basic data (`user-read-private` historically) | No `country`, `email`, `product`. New `account_id` (stable). | Yes |
| My playlists | `GET /me/playlists` | `playlist-read-private` (+ `playlist-read-collaborative` for collaborative) | `limit` max 50, `offset` max 100,000. Returns `items: {href,total}`; `tracks` deprecated. Includes followed playlists of others. | Yes |
| Get one playlist | `GET /playlists/{id}` | `playlist-read-private` | `items` only for owned/collaborative playlists. | Yes |
| Playlist items | `GET /playlists/{id}/items` | `playlist-read-private` | `limit` max 50. Only owned or collaborative playlists; others give 403. Each entry has `added_at`, `added_by`, `is_local`, `item` (`track` deprecated). Supports `fields` filter. | Yes |
| Saved tracks | `GET /me/tracks` | `user-library-read` | `limit` max 50. Entry: `added_at`, `track`. | Yes |
| Top artists/tracks | `GET /me/top/{artists|tracks}` | `user-top-read` | `time_range`: `short_term` (~4 weeks), `medium_term` (~6 months, default), `long_term` (~1 year). `limit` max 50, `offset`. | Yes |
| Recently played | `GET /me/player/recently-played` | `user-read-recently-played` | `limit` max 50. Cursor paging with `after`/`before` (Unix ms). Each item has `track`, `played_at`, `context` (`type`, `uri`, `href`) - `context.uri` is the playlist URI when played from a playlist. No podcast episodes. | Yes |
| Create playlist | `POST /me/playlists` | `playlist-modify-public`, `playlist-modify-private` | Body: `name`, `public`, `collaborative`, `description`. Max ~11,000 playlists per user. `POST /users/{id}/playlists` is removed. | Yes |
| Add items | `POST /playlists/{id}/items` | `playlist-modify-public` / `-private` | Max 100 URIs per request. Optional `position`. Returns `snapshot_id`. Local files cannot be added. | Yes |
| Reorder / replace items | `PUT /playlists/{id}/items` | same | Replace: `uris`, max 100. Reorder: `range_start`, `insert_before`, `range_length`, `snapshot_id`. Not both in one call. | Yes |
| Remove items | `DELETE /playlists/{id}/items` | same | Body `items: [{uri}]` (not `tracks`), max 100, optional `snapshot_id`. | Yes |
| "Delete" playlist | `DELETE /me/library?uris=spotify:playlist:{id}` | `playlist-modify-public` (page also lists `user-library-modify`, `user-follow-modify`) | Max 40 URIs. Old `DELETE /playlists/{id}/followers` is deprecated/removed. The API has **no true delete**: removing your own playlist only unfollows it ([Playlists concept](https://developer.spotify.com/documentation/web-api/concepts/playlists)). | Yes (path documented; playlist-unfollow behaviour via `/me/library` is **UNVERIFIED** by test) |
| Check library | `GET /me/library/contains?uris=` | `user-library-read` / `user-follow-read` (assumed) | | Yes (scopes **UNVERIFIED**) |
| Search | `GET /search` | none required | `limit` max 10, default 5, `offset` max 1000. Types: album, artist, playlist, track, show, episode, audiobook. | Yes |
| Start playback | `PUT /me/player/play` | `user-modify-playback-state` | **Premium only.** Body: `context_uri` or `uris`, `offset`, `position_ms`; query `device_id`. | Yes |
| Other player | `GET /me/player`, `/me/player/devices`, `/me/player/currently-playing`, `PUT /me/player/pause`, `/seek`, `/repeat`, `/shuffle`, `/volume`, `POST /me/player/next`, `/previous`, `POST /me/player/queue`, `PUT /me/player` (transfer) | `user-read-playback-state`, `user-modify-playback-state`, `user-read-currently-playing` | Premium for control endpoints. Execution order not guaranteed. | Yes |

Sources: the reference page for each endpoint under https://developer.spotify.com/documentation/web-api/reference/ (get-recently-played, get-users-top-artists-and-tracks, get-a-list-of-current-users-playlists, get-playlists-items, get-users-saved-tracks, create-playlist, add-items-to-playlist, reorder-or-replace-playlists-items, remove-items-playlist, remove-library-items, unfollow-playlist, start-a-users-playback, search).

### Important gaps for this app

- **No "last opened" or play count per playlist.** No endpoint gives this. The only signal is `context.uri` in recently played. That covers only the last 50 plays (the reference page does not state a retention window; the 50-item cap is widely reported, retention length is **UNVERIFIED**). To find "playlists I no longer open", the app must poll recently played often (for example every 15-30 minutes) and store a local log over weeks. An alternative is the user's GDPR "Extended streaming history" export (outside the Web API, not researched here).
- **No transitions API.** Playlist transitions ("Mix": fade, rise, blend; launched in beta August 2025, consumer app only) have no Web API endpoint. No field in playlist or player objects exposes them. A community request asks Spotify to expose them ([forum thread](https://community.spotify.com/t5/Spotify-for-Developers/Expose-Mix-Transition-Controls-in-Spotify-Web-API/m-p/7418126)), with no published response found. The app can only create the ordered playlist; the user must add transitions in the Spotify app. No crossfade control exists in the player API either.
- **No audio features.** DJ ordering by BPM/key/energy needs an external source (UNVERIFIED which one; out of scope here).
- **No batch lookups.** Metadata for many tracks costs one request per item. Prefer the full objects already returned by playlist items, saved tracks, top items and recently played.
- **Other users' playlists:** you can list followed playlists, but you cannot read their items (403). Analysis is limited to owned and collaborative playlists.

**Verdict:** All endpoints needed for (a), (b) and (c) work in dev mode with the new paths. (c) needs a local play log built from recently played. (d) can build and order a playlist, but transitions must be set manually in the Spotify app.

---

## 4. Authentication

- **Flow:** Authorization Code with PKCE for a client-only app. Authorization Code with secret only if the secret stays on a backend. Implicit grant is removed (2025-11-27). Client Credentials gives no user data.
- **Redirect URI rules** ([Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri)):
  - Must exactly match a registered URI.
  - HTTPS is required, **except** for loopback IP literals, where HTTP is allowed.
  - Use `http://127.0.0.1:<port>/callback` or `http://[::1]:<port>/callback`.
  - **`localhost` is not allowed.** Serve the dev app on `127.0.0.1`, not `localhost`, or the browser origin and the redirect will not match.
  - For loopback IPs, a URI registered without a port accepts any port in the request.
  - Enforced for new apps since 2025-04-09, for all apps since 2025-11-27.
- **Tokens** ([Refreshing tokens](https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens), [Blog 2026-06-18](https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration)):
  - Access token: 3600 s.
  - Refresh token: expires **6 months after the user authorized**. Refreshing does not extend it. New apps since 2026-06-18, existing apps since 2026-07-20.
  - A refresh response may contain a new `refresh_token`. If present, store it and drop the old one.
  - PKCE refresh: send `client_id` in the form body, no `Authorization` header. `Content-Type: application/x-www-form-urlencoded`.
  - `invalid_grant` means expired or revoked: discard and run the full login again. Do not retry.
- **AI / data rules** ([Building with AI](https://developer.spotify.com/documentation/web-api/tutorials/building-with-ai)): no training of ML models on Spotify data; do not cache Spotify content beyond immediate use; keep the client secret out of client code; request minimum scopes. Whether sending data to an LLM for analysis is allowed is not stated (**UNVERIFIED**; check Developer Terms). The caching rule is a policy risk for a long-lived local play log.

**Verdict:** Use PKCE with `http://127.0.0.1:<port>/callback`. Plan a re-login every 6 months. Handle refresh-token rotation and `invalid_grant`.

---

## 5. Rate limits and pagination

- **Rate limit:** computed over a **rolling 30-second window**. On excess: HTTP 429 with a `Retry-After` header in seconds. No numbers are published for either mode ([Rate limits](https://developer.spotify.com/documentation/web-api/concepts/rate-limits)).
- **Dev-mode quota:** a separate limit from the rate limit. Since 2026-07-23 it is shared per developer account. When exceeded, the 429 body has `{"error": {"status": 429, "message": "Too many requests", "reason": "QUOTA_EXCEEDED"}}`. The quota size and reset period are not published (**UNVERIFIED**). Treat `QUOTA_EXCEEDED` differently from a short rate-limit 429: stop and back off for longer.
- **Recommended practice:** honour `Retry-After`, exponential backoff, compare playlist `snapshot_id` to skip unchanged playlists, lazy-load. (The page still recommends "Get Multiple Albums" batch calls, but those are removed for dev mode.)
- **Pagination limits:**
  - `/me/playlists`, `/playlists/{id}/items`, `/me/tracks`, `/me/top/*`: `limit` max 50, offset paging.
  - `/me/player/recently-played`: `limit` max 50, cursor paging (`after`/`before`).
  - `/search`: `limit` max 10, `offset` max 1000.
  - Playlist write calls: max 100 items per request. `/me/library`: max 40 URIs.

**Verdict:** Use a single request queue with Retry-After handling, caching by `snapshot_id`, and incremental sync. Keep total calls low because the dev-mode quota is unknown.

---

## 6. `@spotify/web-api-ts-sdk`

Evidence (checked 2026-10-13):
- Latest npm version **1.2.0**, published **2024-01-17**. No release since.
- Last commit on GitHub `main`: **2025-10-15** (removed implicit grant strategy). Repo not archived. 67 open issues.
- The 1.2.0 package uses the **old paths**: `playlists/{id}/tracks`, `users/{user_id}/playlists`, `users/{userId}`, `playlists/{id}/followers`, `me/following`, `me/tracks` (save/remove), `me/albums`, and per-type `/contains`. It has no `/items`, `POST /me/playlists`, or `/me/library`.
- Issue [#159](https://github.com/spotify/spotify-web-api-ts-sdk/issues/159) (2026-08-04) reports 403 on `GET/POST/DELETE /playlists/{id}/tracks` and `POST /users/{id}/playlists` in dev mode. A comment confirms that switching to `/items` fixed it.
- Types still describe removed fields (`popularity`, `followers`) and the old `tracks` playlist shape.

Options: raw `fetch` with own TypeScript types (small surface: ~20 endpoints), or the SDK's generic `makeRequest` only for its auth helper. The official OpenAPI spec could also generate types (**UNVERIFIED** whether it is updated for the February 2026 paths).

**Verdict:** Do not rely on the SDK's typed methods. It is effectively unmaintained and calls removed endpoints. Use raw `fetch` with a thin typed client and own PKCE code (or a small PKCE library).

---

## Summary of risks

1. Owner must keep Premium, or the app stops working.
2. No audio features, recommendations or related artists: DJ ordering needs another data source.
3. No transitions API: transitions must be added by hand in the Spotify app.
4. "Unused playlist" detection depends on a self-built play log from recently played (50-item window); this conflicts in spirit with the "no caching beyond immediate use" rule.
5. Dev-mode quota is unpublished and shared per account; batch endpoints are gone, so per-item lookups are expensive.
6. No true playlist delete; `DELETE /me/library` with a playlist URI unfollows (to be confirmed by a test).
7. Refresh tokens expire after 6 months; re-login needed.
8. Spotify has changed dev-mode rules several times in 2026; more changes are likely.
