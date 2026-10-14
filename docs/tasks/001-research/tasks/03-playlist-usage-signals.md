# 03 — Signals for "playlist not opened anymore"

**Status:** done
**Date:** 2026-10-13
**Question:** Which data tells us that the user no longer uses a playlist? How do we delete it safely?

## Summary

- The Web API has **no** "last played" or "last opened" field for a playlist.
- The only direct API signal is the `context` object in **Get Recently Played Tracks**. It covers the last 50 plays only.
- The **Extended streaming history** export has the full lifetime of plays. It has **no** playlist or context field. We must infer usage from track URIs.
- The **Technical Log Information** export is the surprise. Real exports contain `KmPageView.json` with `message_view_uri: "spotify:playlist:…"` (a playlist page was opened, at least on desktop/web). `TrackNotPlayed.json` has `message_play_context`. This is the closest thing to a real "last opened" signal. Coverage and retention are **UNVERIFIED**.
- Since February 2026, Development Mode apps get playlist `items` **only for playlists the user owns or collaborates on**. For followed playlists we cannot read the track list through the API. This breaks track-join scoring for followed playlists.
- Delete = `DELETE /me/library?uris=spotify:playlist:{id}` (the old `DELETE /playlists/{id}/followers` was removed for Dev Mode apps). For an owned playlist this is the same as "delete". Owned playlists can be restored for 90 days at <https://www.spotify.com/account/recover-playlists/>.

**Overall verdict:** **Doable with a workaround.** Combine (1) data-export signals, (2) our own poller for contexts from now on, and (3) owned-playlist metadata. Always end with a human review step.

---

## 1. Web API signals

### 1.1 Get Recently Played Tracks

Source: <https://developer.spotify.com/documentation/web-api/reference/get-recently-played>

- Endpoint: `GET /v1/me/player/recently-played`. Scope: `user-read-recently-played`.
- `limit`: default 20, **max 50**.
- `after` / `before`: Unix time in ms. You can set only one of them.
- Each item has `track`, `played_at`, and `context`.
- `context` has `type` (`"artist"`, `"playlist"`, `"album"`, `"show"`), `uri`, `href`, `external_urls`.
- So yes: when you play from a playlist, `context.uri` is `spotify:playlist:{id}`.
- The docs say: "Currently doesn't support podcast episodes."
- The docs do **not** say how far back the history goes.
- The endpoint is still available after the February 2026 changes. Source: <https://developer.spotify.com/documentation/web-api/references/changes/february-2026>

**How far back:** In practice only the **last 50 plays**. The `before` cursor returns empty pages beyond those 50. This is from community reports, not from the docs.

- <https://community.spotify.com/t5/Spotify-for-Developers/quot-Current-User-s-Recently-Played-Tracks-quot-before-param-not/m-p/5137480/highlight/true>
- <https://community.spotify.com/t5/Spotify-for-Developers/before-and-after-are-utterly-useless-with-me-player-recently/td-p/5520713>
- The `your_spotify` project says that without an import it "will only retrieve data for the past 24 hours once registered. This is a technical limitation." <https://raw.githubusercontent.com/Yooooomi/your_spotify/master/README.md>

**Known gaps in `context`** (community reports, not official):

- Plays from **Liked Songs** often come back with `context: null`. When present, the Liked Songs URI looks like `spotify:user:{username}:collection`.
- Some accounts get `context: null` for every play. Support fixed it for some users.
  - <https://community.spotify.com/t5/Spotify-for-Developers/Playlist-context-is-NULL-for-certain-user-s-Recently-Played/m-p/5366460/highlight/true>
  - <https://community.spotify.com/t5/Spotify-for-Developers/Context-is-null-on-recently-played-tracks-requests-from-Spotify/m-p/5411117/highlight/true>
  - <https://community.spotify.com/t5/Spotify-for-Developers/Playlist-Null-when-getting-Recently-Played-tracks/td-p/5485929>
- Private Session plays and plays under ~30 s do not appear. Offline plays may not appear.
  - <https://community.spotify.com/t5/Spotify-for-Developers/Recently-Played-tracks-don-t-seem-to-show-plays-of-downloaded/m-p/6061510/highlight/true>
  - <https://community.spotify.com/t5/Spotify-for-Developers/Get-Recently-Played-Tracks-doesn-t-return-skipped-tracks/td-p/5339618>

**Verdict:** Gives real playlist context, but only for the last 50 plays. Useful only if we poll it over time (see section 4).

### 1.2 "Recently played contexts" (the app's home shelf)

- There is **no** public endpoint for "Jump back in" or recently played playlists/albums.
- Community answers point to the recently-played tracks endpoint as the only option. <https://community.spotify.com/t5/Spotify-for-Developers/Is-there-a-way-to-fetch-a-user-s-recently-played-playlists/td-p/6496040>
- The Spotify clients use internal APIs for this shelf. Using them breaks the Developer Terms. We will not use them.

**Verdict:** Not doable via the public API.

### 1.3 `snapshot_id`

Sources: <https://developer.spotify.com/documentation/web-api/concepts/playlists>, <https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists>

- `snapshot_id` is "The version identifier for the current playlist." It changes on every edit.
- It is **not** a timestamp. We can only detect "changed since last check" if we store it and compare later.
- For playlists owned by others (editorial, other users), the owner's edits change it. That says nothing about the user's own usage.

**Verdict:** Weak signal. Use only as "owner edited since we last looked".

### 1.4 `added_at` on playlist items

Source: <https://developer.spotify.com/documentation/web-api/reference/get-playlists-items>

- `GET /v1/playlists/{id}/items`. `limit` max 50.
- Each item has `added_at`, `added_by`, `is_local`, `item` (`track` is deprecated).
- "some very old playlists may return `null` in this field."
- **Restriction:** "only accessible for playlists owned by the current user or playlists the user is a collaborator of." Others return 403.
- February 2026 migration guide: "Playlist contents (`items`) are only returned for playlists the user owns or collaborates on." <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>
- `max(added_at)` = the last time anyone added a track. Good proxy for "last curated" on owned playlists.

**Verdict:** Good "last modified" proxy for **owned/collaborative** playlists only. Not available for followed playlists.

### 1.5 Get Current User's Playlists

Source: <https://developer.spotify.com/documentation/web-api/reference/get-a-list-of-current-users-playlists>

- `GET /v1/me/playlists` returns playlists "owned or followed by the current Spotify user". `limit` max 50.
- Fields: `collaborative`, `owner`, `public`, `snapshot_id`, `items { href, total }`.
- No "last modified" or "last played" field.
- `owner.id` tells us owned vs followed.

### 1.6 Spotify-owned and algorithmic playlists

- Since 2024-11-27, new and Dev Mode apps cannot access "Algorithmic and Spotify-owned editorial playlists". <https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api>
- Get Playlist / Get Playlist Items return 404 for them. Discover Weekly showed up as `null` in `/me/playlists` for some time. Spotify says it fixed the `null` entries.
  - <https://community.spotify.com/t5/Spotify-for-Developers/Discover-Weekly-playlist-appears-as-null-when-using-Get-User/m-p/6551114>
  - <https://community.spotify.com/t5/Spotify-for-Developers/playlists-API-Endpoint-Issue-Fixed/m-p/6589015/highlight/true>
- A community moderator says Discover Weekly, Daily Mix and Release Radar cannot be removed from the library. <https://community.spotify.com/t5/Your-Library/How-do-I-unfollow-a-Discover-Weekly-playlist-that-belongs-to-a/m-p/5450186/highlight/true>
- Daylist and Blend behaviour through the API: **UNVERIFIED**.

**Verdict:** Exclude any playlist with `owner.id == "spotify"` (and `null` entries) from deletion candidates.

---

## 2. "Download your data" packages

Sources:

- <https://support.spotify.com/us/article/understanding-your-data/> (packages and field descriptions)
- <https://support.spotify.com/us/article/data-rights-and-privacy-settings/> (how to request)
- Request page: <https://www.spotify.com/account/privacy/> (login needed)

### 2.1 Packages and delivery time

| Package | Content | Delivery time |
|---|---|---|
| Account data | Playlists, library, last year of streaming, search, etc. | "Takes a maximum of 5 days" (your_spotify README). Not stated on Spotify's help page. |
| Extended streaming history | All plays, lifetime of account | Up to 30 days. Often 1–5 days, sometimes next day. |
| Technical log information | Client event logs (157 files in one real export) | About a week in one real case. |

- The 5 / 30 day numbers come from third parties, not from the Spotify help page. Treat them as **UNVERIFIED** official limits.
  - <https://raw.githubusercontent.com/Yooooomi/your_spotify/master/README.md>
  - <https://jrtechs.net/data-science/the-data-spotify-collected-on-me-over-ten-years> (extended history arrived next day; account data and technical log about a week later)
- You must confirm the request via email, or processing does not start. <https://support.trackify.am/import/guide>

### 2.2 Account data files

Real file list from one 2026 export (jrtechs.net):
`DuoNewFamily.json`, `Follow.json`, `Identifiers.json`, `Identity.json`, `Marquee.json`, `Payments.json`, `Playlist1.json`, `SearchQueries.json`, `StreamingHistory_audiobook_0.json`, `StreamingHistory_music_0.json`, `StreamingHistory_music_1.json`, `StreamingHistory_podcast_0.json`, `UserAddress.json`, `Userdata.json`, `UserFestivalsDataForSAR.json`, `UserPrompts.json`, `Wrapped2024.json`, `YourLibrary.json`, `YourSoundCapsule.json`, `Read_Me_First.pdf`.

**`Playlist1.json`** (more files `Playlist2.json`… if large). Structure from real parsers:

```json
{
  "playlists": [
    {
      "name": "…",
      "lastModifiedDate": "2022-05-05",
      "items": [
        {
          "track": { "trackName": "…", "artistName": "…", "albumName": "…", "trackUri": "spotify:track:…" },
          "episode": null,
          "localTrack": null,
          "addedDate": "2022-05-01"
        }
      ],
      "description": null,
      "numberOfFollowers": 0
    }
  ]
}
```

- **Yes, `lastModifiedDate` exists.** It is a date only (`YYYY-MM-DD`), no time.
- **No playlist URI.** A parser notes `uri` is "absent in Spotify-official exports". We must match to API playlists by **name** (plus track overlap to break ties).
- Help page says it covers "playlists created or saved". Whether followed playlists include their track lists: **UNVERIFIED**.
- Sources:
  - <https://github.com/ttybitnik/diego/blob/main/internal/app/social/spotify/playlist.go>
  - <https://github.com/Prog-Jacob/spicetify-apps/blob/main/apps/data-porter/src/types/export.ts>
  - <https://github.com/purarue/HPI/blob/master/my/spotify/gdpr.py>

**`StreamingHistory_music_N.json`** (last year only): `endTime`, `artistName`, `trackName`, `msPlayed`. **No track URI, no context.** Weak for joining.

**`SearchQueries.json`**: `platform`, `searchTime`, `searchQuery`, `searchInteractionURIs`. If a playlist URI appears in `searchInteractionURIs`, the user opened that playlist from search. Small but real "opened" signal.

### 2.3 Extended streaming history files

File names: `Streaming_History_Audio_<YYYY>-<YYYY>_<n>.json` (one or more files per year range, numbered from 0), `Streaming_History_Video_<YYYY>-<YYYY>.json`, `ReadMeFirst_ExtendedStreamingHistory.pdf`.

Real record (elastic-labs example):

```json
{
  "ts": "2010-06-16T16:33:36Z",
  "platform": "iPhone 11",
  "ms_played": 284289,
  "conn_country": "AT",
  "ip_addr": "11.144.233.10",
  "master_metadata_track_name": "Kiss me twice",
  "master_metadata_album_artist_name": "Parov Stelar",
  "master_metadata_album_album_name": "Hôtel Costes 9",
  "spotify_track_uri": "spotify:track:3NVWHqOWoYQyewSBO3g8Mt",
  "episode_name": null,
  "episode_show_name": null,
  "spotify_episode_uri": null,
  "audiobook_title": null,
  "audiobook_uri": null,
  "audiobook_chapter_uri": null,
  "audiobook_chapter_title": null,
  "reason_start": "trackdone",
  "reason_end": "trackdone",
  "shuffle": false,
  "skipped": false,
  "offline": false,
  "offline_timestamp": null,
  "incognito_mode": false
}
```

- `ts` = stream **end** time, UTC.
- Older exports also had `username`, `user_agent_decrypted`, `ip_addr_decrypted`. Newer ones use `ip_addr` and add `audiobook_*`. Parse leniently.
- `reason_start` values confirmed in sources: `trackdone`, `fwdbtn`, `playbtn`. Other values often seen in parsers (`clickrow`, `backbtn`, `appload`, `remote`, `trackerror`) are **UNVERIFIED** here. No official list exists.
- **There is no context / playlist field.** The help page only mentions playlists in the description of the start reason ("you picked it from the playlist").
- Some records have null metadata but non-zero `ms_played`. <https://community.spotify.com/t5/Other-Podcasts-Partners-etc/Extended-Streaming-History-missing-track-metadata/td-p/6269152>
- Sources:
  - <https://github.com/elastic/elastic-labs/blob/main/supporting-blog-content/spotify-to-elasticsearch/to_read/example.json>
  - <https://github.com/nordbobirk/better-spotify-wrapped/blob/main/internal/types.go>
  - <https://github.com/Wallerand/spotify-unwrapped>

### 2.4 Technical log information

Help page: "detailed technical data such as commands, error messages, and log strings". One export had 157 files, about 105 MB. File list: <https://jrtechs.net/data-science/the-data-spotify-collected-on-me-over-ten-years>

Field names below come from real exports on GitHub and from schemas in <https://github.com/UChicagoSUPERgroup/dsar-export-schemas/tree/main/schemas/Spotify/Spotify%20Technical%20Log%20Information>.

| File | Useful fields | What it tells us |
|---|---|---|
| `KmPageView.json` | `timestamp_utc`, `message_view_uri` (e.g. `spotify:playlist:4ZdINXQPnnOLbGK6joIP9A`), `message_page` (`/playlist`), `message_type` (`enter`/`exit`), `context_application_version` | **A playlist page was opened.** Real "last opened" signal. |
| `KmInteraction.json` | `message_view_uri` (e.g. `/playlist/3bQZ…`), `message_target_uri` | Clicks inside a playlist page. |
| `TrackNotPlayed.json` | `message_play_context` (e.g. `spotify:playlist:3kTk…`, `spotify:user:…:collection`), `message_source_start` (`playlist/ondemand`) | Has play context, but only for tracks that did **not** play. |
| `RawCoreStream.json` | `message_content_uri`, `message_ms_played`, `message_reason_start`, `message_shuffle` | Real streams. The export schema has **no** play-context field (the client protocol has `play_context`, but the export drops it). |
| `AddedToRootlist.json` / `RemovedFromRootlist.json` | `message_item_uri`, `timestamp_utc` | When a playlist was added to / removed from the user's library. |
| `PlaylistCreated.json`, `AddedToPlaylist.json`, `RemovedFromPlaylist.json` | (fields not checked) | Curation activity. |
| `DownloadInteraction.json` | `message_download_uri`, `message_view_uri` (`spotify:playlist:…`) | User downloaded a playlist (offline use). |

Real samples:

- `KmPageView.json`: <https://github.com/egonik-unlp/my-spotify-data/blob/main/technical-report/Spotify%20Technical%20Log%20Information/KmPageView.json> (app version `1.2.x` = desktop client)
- `TrackNotPlayed_Hourly.json`: <https://github.com/IoniKul1/Spotify-Project/tree/main/Tech%20data%20Spotify>

Caveats:

- `KmPageView` samples come from desktop (`1.2.x`) and web. Whether mobile page views appear: **UNVERIFIED**.
- How far back the technical log goes: **UNVERIFIED**. The samples cover a few months, not years.
- File names change between exports (e.g. `TrackNotPlayed_Hourly.json`). Parse by prefix.

**Verdict:** Extended history gives lifetime plays but no context. The technical log gives **direct playlist-open events** for at least desktop/web, for an unknown recent window. Both are worth importing.

---

## 3. Inference when no direct signal exists

### 3.1 Track-join score (extended streaming history × playlist tracks)

For each playlist P with a known track list:

- `plays_N(P)` = count of history rows in the last N months where `spotify_track_uri ∈ tracks(P)` and `ms_played ≥ 30000`.
- `coverage_N(P)` = distinct played tracks of P / total tracks of P.
- `last_track_play(P)` = latest `ts` of any track in P.
- `unique_plays_N(P)` = same as `plays_N`, but only for tracks that are **in P only** (not in any other playlist the user keeps, not in Liked Songs).

Notes:

- Track lists come from the API for owned/collaborative playlists, or from `Playlist1.json` (owned at least).
- Match on track URI first. Fall back to normalized `artist + track name`, because the same song can have several URIs (re-releases, market relinking).
- `reason_start` helps a little. `clickrow` / `playbtn` = user picked the track. `trackdone` = continued in some context (could be album, radio, autoplay).

### 3.2 False positives and negatives

- **Shared tracks (false "in use"):** A track in P is also in Liked Songs or another playlist. The user played it there, not in P. `unique_plays` reduces this.
- **Radio / autoplay / Smart Shuffle (false "in use"):** Spotify plays a track from P outside P.
- **Small playlists (noisy):** 3-track playlists get high or zero coverage by chance.
- **Shuffle on big playlists (false "unused"):** a 1000-track playlist played sometimes still has low coverage. Use plays, not only coverage.
- **Offline / private session (false "unused"):** extended history records offline plays (`offline`, `incognito_mode`), the poller does not.
- **Delay:** history only goes to the export date. Recent plays need the poller.

### 3.3 Metadata signals

- `lastModifiedDate` (export) and `max(added_at)` (API) = last curation. Recently edited → probably still used.
- `owner.id == me` → deletable and recoverable. Followed → only unfollow, re-follow is the undo.
- `owner.id == "spotify"` → algorithmic/editorial. Exclude.
- `collaborative` → others may use it. Show a warning.
- `numberOfFollowers` (export) > 0 → others follow the user's playlist. Deleting removes it from the user's library; followers keep access (concepts page). Show a warning.

### 3.4 Followed playlists (not owned)

- The API returns no track list for them (February 2026 rule for Dev Mode apps).
- Usable signals: poller contexts, `KmPageView`, `SearchQueries.searchInteractionURIs`, `AddedToRootlist` date.
- If none of these show activity, mark as "no evidence of use". Low risk, because re-following is easy.

**Verdict:** Doable with a workaround. Track-join works well for owned playlists. Followed playlists depend on context and page-view signals.

---

## 4. Ongoing collection (poller)

Plan: every ~20 minutes call `GET /me/player/recently-played?limit=50&after={last_played_at_ms}` and store `played_at`, `track.id`, `context.uri`.

### 4.1 Is it allowed?

- Developer Policy, section I.1: "you may store users' personal data for as long as is necessary to provide your SDA." On disconnect, you must "delete and no longer request or process any of that user's personal data." <https://developer.spotify.com/policy>
- The policy sets **no** polling interval. Spotify "may use quotas and restrictions" (VII.3).
- Risk: section III.13 says "Do not analyze the Spotify Content or the Spotify Service for any purpose, including without limitation, creating new or derived listenership metrics, benchmarking, functionality, usage statistics, user metrics, or building profiles of users…". A strict reading could cover usage scoring. For a single-user, local, non-commercial app the practical risk is low. This is our reading, not Spotify's.
- Prior art: `your_spotify` (self-hosted, ~4k stars) does exactly this: "a web server which polls the Spotify API every now and then". <https://github.com/Yooooomi/your_spotify>
- February 2026: new Dev Mode apps need the owner to have **Premium**, max 5 users, 1 Client ID. Fine for personal use. <https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide>

### 4.2 How reliable?

- 20 minutes ≈ 5–7 normal tracks. 50 items is plenty unless the user skips very fast. Use 10–15 minutes to be safe; the cost is tiny.
- Dedupe by `played_at` + track ID.
- Misses: Private Session, plays under ~30 s, offline plays (may never show up), podcasts.
- `context` can be `null` (Liked Songs, some accounts). Store it anyway; count `null` as "unknown".
- The machine must be on, or the poller must run on a small always-on host. Gaps longer than ~50 plays are lost. Fill gaps with a later extended-history import (no context, but plays).
- Context means "played from P". It does not catch "opened P but did not play". That is acceptable: the user's goal is "playlists I don't use".

**Verdict:** Allowed in practice, cheap, and the only source of **ongoing** playlist context. Start it early, because its value grows with time.

---

## 5. Deleting

### 5.1 API call

- Current: `DELETE /v1/me/library?uris=spotify:playlist:{id}` (max 40 URIs). Scopes listed: `user-library-modify`, `user-follow-modify`, `playlist-modify-public`. Docs do not say which scope applies to playlists; request `playlist-modify-private` too. <https://developer.spotify.com/documentation/web-api/reference/remove-library-items>
- Old: `DELETE /v1/playlists/{id}/followers` — marked deprecated and **removed** for Dev Mode apps in February 2026. <https://developer.spotify.com/documentation/web-api/reference/unfollow-playlist>, <https://developer.spotify.com/documentation/web-api/references/changes/february-2026>
- Undo by API: `PUT /v1/me/library?uris=spotify:playlist:{id}` (re-follow).

### 5.2 Delete vs unfollow

- Concepts page: "We have no endpoint for deleting a playlist in the Web API". When an owner removes their playlist, "you are simply unfollowing it". <https://developer.spotify.com/documentation/web-api/concepts/playlists>
- Other followers keep access to it.
- **Followed (not owned) playlists can also be removed** with the same call. "Any playlist can be followed — public, private, and collaborative."
- Spotify algorithmic playlists (Discover Weekly etc.) cannot be removed (community moderator, see 1.6).

### 5.3 Is it reversible?

- **Verified:** "If you deleted a playlist within the last 90 days, you can get it back". Page: <https://www.spotify.com/account/recover-playlists/>. Source: <https://support.spotify.com/us/article/save-recover-playlists/>
- The concepts page says that restoring through the account page is the same as re-following your own unfollowed playlist. So an API unfollow of an owned playlist should appear on the recover page. Not tested: **UNVERIFIED** end to end.
- Followed playlists probably do not appear on the recover page (**UNVERIFIED**). The undo is to re-follow by URI, which works as long as the owner keeps the playlist.
- A guide says deleted collaborative playlists cannot be recovered. **UNVERIFIED.** <https://androidauthority.com/recover-deleted-playlists-spotify-3225746>
- Recovery after 90 days: support only, no guarantee.

**Safety rules for our app:**

1. Before deletion, save a local JSON backup: playlist URI, name, owner, description, and the full track list (if available).
2. Log every delete with time and URI, so we can re-follow by API.
3. Never auto-delete. Show candidates, let the user confirm.

**Verdict:** Doable via API. Owned playlists: 90-day recovery by Spotify plus our own backup. Followed playlists: re-follow by URI.

---

## Recommended scoring approach

For each playlist compute these signals (newest timestamp wins):

| Signal | Source | Weight |
|---|---|---|
| `last_context_play` | Poller + `TrackNotPlayed.message_play_context` | Strong (direct) |
| `last_page_view` | `KmPageView.message_view_uri`, `KmInteraction`, `SearchQueries.searchInteractionURIs`, `DownloadInteraction` | Strong (direct) |
| `last_unique_track_play`, `unique_plays_12m` | Extended history × track list | Medium (inferred) |
| `plays_12m`, `coverage_12m` | Extended history × track list | Weak (shared tracks) |
| `last_curated` | `max(added_at)`, `lastModifiedDate`, `AddedToRootlist` | Medium (activity, not listening) |

Then:

- `last_used = max(direct signals, inferred signals)`.
- **Exclude:** Spotify-owned, `null` entries, playlists created/followed in the last N months.
- **Candidate:** no direct signal in N months (default 12) **and** `unique_plays_12m` near zero **and** no curation in N months.
- **Review:** mixed evidence (e.g. only shared-track plays). Show the reasons.
- **Keep:** any direct signal in N months.
- Show the evidence for each playlist in the UI. The user confirms each delete.
