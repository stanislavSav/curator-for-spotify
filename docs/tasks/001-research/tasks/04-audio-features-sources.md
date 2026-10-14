# 04 — Audio features and genre sources (after the Spotify deprecations)

Research date: 2026-10-13.
Scope: where a local, personal React/TS app (optional Node backend) can get per-track BPM, key/mode, energy (and similar) and genre/mood tags for tracks known by Spotify ID or ISRC.

Status labels used below:

- **TESTED** — I called the endpoint with `curl` on 2026-10-13 and show the real response.
- **DOCS** — taken from the provider's own documentation page.
- **UNVERIFIED** — from third-party sources or memory. Not confirmed.

---

## 1. Short answer

1. **ReccoBeats** is the best primary source. It takes Spotify track IDs directly, needs no key, allows CORS from `localhost`, and returns the same fields as the old Spotify `audio-features` (tempo, key, mode, energy, danceability, valence, loudness, ...). The values match the old Spotify values. TESTED.
2. **Deezer** is the best free fallback for BPM. Look up by ISRC. It returns `bpm` (sometimes `0` = unknown), `gain`, and a 30 s `preview` MP3. No key. No CORS on the API, so call it from the Node backend. TESTED.
3. **Local analysis with Essentia.js** on the Deezer 30 s preview fills the gaps for key and BPM. It ran in Node in ~2 s per track and gave plausible results. TESTED.
4. **Genres/moods**: use **MusicBrainz/ListenBrainz** tags (free, no key, via ISRC → MBID) plus **Last.fm** top tags (free key, non-commercial only) for mood words. **Discogs** styles are a good optional extra. Spotify artist `genres` is still in the docs but is marked **Deprecated**. Whether it is still populated for Development Mode apps is UNVERIFIED.

---

## 2. Spotify status in 2026 (context)

Source: [February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Feb 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026), [March 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026), [Get Artist reference](https://developer.spotify.com/documentation/web-api/reference/get-an-artist), [Get Track reference](https://developer.spotify.com/documentation/web-api/reference/get-track).

- `audio-features`, `audio-analysis`, `recommendations`, related artists: unavailable to apps created after 2024-11-27 (return 403).
- 2026-02-11 (new apps) / 2026-03-09 (all Development Mode apps):
  - Batch endpoints removed: `GET /tracks`, `GET /artists`, `GET /albums`, ... Use single-ID calls (`GET /tracks/{id}`, `GET /artists/{id}`).
  - Removed fields: track `popularity`, `available_markets`, `linked_from`; artist `followers`, `popularity`; album `label`, `popularity`.
  - Track/album `external_ids` were removed in February and **reverted (restored) in March 2026**. So `external_ids.isrc` is available. DOCS.
  - Playlist `tracks` renamed to `items`. Playlist contents only for playlists the user owns or collaborates on.
  - Search `limit` max 50 → 10.
  - Owner needs Spotify Premium. New apps: max 5 users.
- **Artist `genres`**: still listed in the artist object, but marked **Deprecated** ("A list of the genres the artist is associated with. If not yet classified, the array is empty."). It is not in the Feb/Mar 2026 removed-field lists. DOCS. Whether it still returns data for a Development Mode app is **UNVERIFIED** — test it with the real app token. Community threads report many empty arrays even before 2026 ([example](https://community.spotify.com/t5/Spotify-for-Developers/Get-Artist-API-is-not-returning-any-or-all-Genres/td-p/6880841)). Treat it as a bonus, not a dependency. Also note: without `GET /artists` (batch), you need one call per artist.
- **`preview_url`**: still in the schema, marked Deprecated, nullable. In practice it is `null` for most tracks since late 2024 (UNVERIFIED for 2026, but widely reported). Do not rely on it.

---

## 3. Providers

### 3.1 ReccoBeats — primary source for audio features

- Site/docs: <https://reccobeats.com/docs/documentation/introduction>, [terms](https://reccobeats.com/docs/documentation/terms-of-service), [rate limiting](https://reccobeats.com/docs/documentation/rate-limiting), [audio extraction](https://reccobeats.com/docs/documentation/Analysis/audio-features-extraction).
- Base URL: `https://api.reccobeats.com`. No key, no auth. DOCS + TESTED.
- Lookup key: **Spotify track ID** in `ids` (also its own UUIDs). TESTED.
- Batch: `GET /v1/audio-features?ids=...` accepts **1–40 IDs**. 41 IDs → `400 {"status":4004,"errors":[{"path":"getAudioFeatures.ids","message":"size must be between 1 and 40"}]}`. TESTED.
- Unknown IDs are **silently dropped** from `content`. Order is not kept. Match results by `href` (contains the Spotify ID). TESTED.
- CORS: answers `access-control-allow-origin: http://localhost:5173` (echoes origin). Browser calls work. TESTED.
- Rate limit: not published. "Configured internally". `429` with `Retry-After`. 30 rapid sequential requests all returned 200. DOCS + TESTED.
- Cost/terms: free for personal and commercial use. "As is". Can block IPs and shut down without notice. Track metadata is aggregated from Spotify; you must follow third-party terms. Terms updated 2026-05-25. DOCS.
- Data source: not stated. The numbers match the old Spotify values exactly (e.g. Blinding Lights energy 0.73, tempo 171.001, valence 0.334), so the catalog looks like a copy of historical Spotify audio features, plus their own model for new tracks (UNVERIFIED).
- Coverage: good for popular tracks in my test. Third-party guides say coverage is inconsistent for niche/new tracks ([musiciwant.com](https://musiciwant.com/studio/spotify-audio-features-alternative)). UNVERIFIED for your library — measure the hit rate on first sync.

Real response — `GET https://api.reccobeats.com/v1/audio-features?ids=0VjIjW4GlUZAMYd2vXMi3b,3n3Ppam7vgaVa1iaRUc9Lp` (TESTED):

```json
{"content":[
  {"id":"636463ea-c943-44d5-b600-1fa6f3ad8057","href":"https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp","isrc":"GBFFP0300052",
   "acousticness":0.00119,"danceability":0.355,"energy":0.918,"instrumentalness":0.0,"key":1,"liveness":0.0971,
   "loudness":-4.36,"mode":1,"speechiness":0.0746,"tempo":148.114,"valence":0.24},
  {"id":"25c8ca63-5895-4572-84eb-a7040bc08c4d","href":"https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b","isrc":"USUG11904206",
   "acousticness":0.00143,"danceability":0.513,"energy":0.73,"instrumentalness":9.54E-5,"key":1,"liveness":0.0897,
   "loudness":-5.94,"mode":1,"speechiness":0.0598,"tempo":171.001,"valence":0.334}
]}
```

Notes:

- `key` is a pitch class 0–11 (0 = C), `mode` 1 = major, 0 = minor (same as old Spotify).
- No `time_signature`, no `duration_ms` in audio-features (duration is in `/v1/track`).
- `GET /v1/track?ids=...` returns title, artists (with Spotify hrefs), `isrc`, `durationMs`, `popularity`. Useful: ReccoBeats still gives `popularity`, which Spotify removed for Dev Mode. TESTED.
- `GET /v1/track/recommendation?seeds=<spotifyId>&size=N` works and returns tracks. TESTED. Parameters are not documented.
- `POST /v1/analysis/audio-features` (multipart `audioFile`, max 5 MB, first 30 s only, MP3/OGG/WAV/AIFF). Returns the same fields **without key/mode**. TESTED with the Blinding Lights Deezer preview: `{"acousticness":0.0151,"danceability":0.5322,"energy":0.74,"instrumentalness":0.0092,"liveness":0.1619,"loudness":-6.3543,"speechiness":0.075,"tempo":94.1648,"valence":0.2539}`. Energy is close (0.74 vs 0.73). Tempo is wrong (94 vs 171). Use it for energy/valence only, not BPM.

### 3.2 Deezer public API — fallback for BPM, source of 30 s previews

- Docs: <https://developers.deezer.com/api> (track pages need login now). [Terms of use](https://developers.deezer.com/termsofuse).
- Lookup: `GET https://api.deezer.com/track/isrc:{ISRC}`. No key for public data. TESTED.
- Fields of interest: `bpm` (float; `0` when unknown), `gain` (dB, replay-gain style loudness), `preview` (30 s MP3, signed URL with ~15 min expiry), `readable`, `rank`, `duration`, `contributors`. TESTED.
- No genre on the track. Genres exist on the album (`/album/{id}` → `genres`) — coarse (e.g. "Pop"). UNVERIFIED in this test.
- CORS: the API sends **no** `access-control-allow-origin`. Call it from the Node backend (or JSONP `output=jsonp`, UNVERIFIED). The preview CDN **does** send `access-control-allow-origin: *`. TESTED.
- Rate limit: commonly reported as **50 requests / 5 s per IP** (error code 4 "Quota limit exceeded"). Not in official docs I could read. UNVERIFIED ([third-party note](https://next.tangled.org/rocksky.app/rocksky/tree/main/deezer)).
- Terms: free, **strictly non-commercial**. Must not bypass DRM to download content. Streaming is "limited to a strictly private use". DOCS. A personal local app fits. Analysing previews in memory is a grey area — not explicitly allowed or forbidden. Do not store audio files.
- ISRC lookup returns one Deezer version. It can be `readable:false` with an empty `preview` (Rick Astley `GBARL9300135` did that). Some ISRCs are unknown (`{"error":{"type":"DataException","message":"no data","code":800}}`). TESTED.

BPM coverage spot-check (TESTED):

| ISRC | Track | Deezer bpm | ReccoBeats tempo |
|---|---|---|---|
| USUG11904206 | The Weeknd – Blinding Lights | 170.84 | 171.001 |
| GBFFP0300052 | The Killers – Mr. Brightside | 148.2 | 148.114 |
| GBARL9300135 | Rick Astley – Never Gonna Give You Up | 113.3 | 113.309 |
| USRC17607839 | Hall & Oates – Crazy Eyes | 150.3 | — |
| GBUM71029604 | Queen – Bohemian Rhapsody (2011 remaster) | **0** | — |

Real response (trimmed) — `GET https://api.deezer.com/track/isrc:USUG11904206`:

```json
{"id":908604612,"readable":true,"title":"Blinding Lights","isrc":"USUG11904206",
 "link":"https://www.deezer.com/track/908604612","duration":200,"track_position":9,"disk_number":1,
 "rank":984833,"release_date":"2020-03-20","explicit_lyrics":false,
 "preview":"https://cdnt-preview.dzcdn.net/api/1/1/1/b/2/0/1b27...mp3?hdnea=exp=1791904165~...",
 "bpm":170.84,"gain":-8.8,"available_countries":["AE","AF","..."],
 "contributors":[{"id":4050205,"name":"The Weeknd","role":"Main", "...":"..."}],
 "artist":{"id":4050205,"name":"The Weeknd", "...":"..."},
 "album":{"id":...,"title":"After Hours", "...":"..."},"type":"track"}
```

### 3.3 GetSongBPM / GetSongKEY

- Docs: <https://getsongbpm.com/api> (behind a Cloudflare challenge; content via search results).
- Base URL `https://api.getsong.co/`. Needs a free API key (`api_key` param or `X-API-KEY` header). Without key: `401` (TESTED).
- Rate limit: **3,000 requests/hour**. Free.
- **Mandatory backlink** to getsongbpm.com on a public website or store page, "even for private, educational, or development use". Accounts without the link are suspended. This is awkward for a purely local app.
- Lookup: **search by title/artist only** (`/search/?type=both&lookup=song:X artist:Y`), then `/song/?id=...`. No Spotify ID or ISRC lookup. You must fuzzy-match.
- Fields: `tempo`, `time_sig`, `key_of` (e.g. "Em"), `open_key` (e.g. "2m"), `danceability`, `acousticness`, plus artist `genres`. Field names **UNVERIFIED** (from memory; only `tempo` confirmed by a [client library](https://metacpan.org/pod/WebService::GetSongBPM)).
- Verdict: usable as a third fallback, but the backlink rule and title matching make it a poor fit.

### 3.4 MusicBrainz + AcousticBrainz + ListenBrainz

**MusicBrainz** — ISRC → recording MBID, tags, genres.

- `GET https://musicbrainz.org/ws/2/isrc/{ISRC}?fmt=json&inc=tags+artist-credits` → recordings with community `tags`. TESTED.
- `GET https://musicbrainz.org/ws/2/recording/{MBID}?fmt=json&inc=genres+tags+artist-credits` → recording and artist `genres` with counts. TESTED. (`inc=genres` is not valid on the `/isrc` resource — TESTED error.)
- No key. **1 request/second per IP**, and a meaningful `User-Agent` is required ([rate-limit doc](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)). Data is CC0 (core) / CC BY-NC-SA (some). Free.

Real (trimmed) — `/ws/2/isrc/USUG11904206?inc=tags`: recording `1a67e215-a19e-40c9-9b12-732de134bf5f` with tags `synth-pop (3), electronic (3), pop (2), electro house (2), new wave (1), synthwave (1), ...`. Artist genres: `r&b (14), alternative r&b (7), contemporary r&b (7), dance-pop (7), pop (3), ...`.

**ListenBrainz** — batch tag lookup by MBID (better than MusicBrainz for bulk).

- `GET https://api.listenbrainz.org/1/metadata/recording/?recording_mbids={mbid1},{mbid2}&inc=tag` → for each MBID: `recording` (name, `isrcs`, length, rels) and `tag` split into `recording`, `release_group`, `artist` lists with `tag`, `count`, `genre_mbid`. TESTED.
- No key for this endpoint. Rate limit header: `x-ratelimit-limit: 30` per ~10 s window. TESTED.

```json
{"1a67e215-...":{"recording":{"name":"Blinding Lights","isrcs":["USUG11904206"],"length":200046,"rels":[...]},
 "tag":{"recording":[{"tag":"synth-pop","count":3,"genre_mbid":"988e91a3-..."},{"tag":"disco","count":1}, ...],
        "release_group":[{"tag":"synth-pop","count":4}, ...],
        "artist":[{"tag":"r&b","count":14,"artist_mbid":"c8b03190-..."}, ...]}}}
```

**AcousticBrainz** — frozen since 2022, API still online.

- Site says data collection stopped in 2022; "For now, the website and its API will continue to be available." Data is CC0. TESTED (homepage).
- `GET https://acousticbrainz.org/api/v1/{MBID}/low-level` → `rhythm.bpm`, `tonal.key_key`, `tonal.key_scale`, `tonal.key_strength`, many spectral stats. `.../high-level` → classifier outputs (`danceability`, `mood_happy`, `mood_sad`, `mood_party`, `mood_relaxed`, `mood_aggressive`, `genre_*`, `voice_instrumental`, ...). Batch: `?recording_ids=a;b;c`. Rate limit 100 per ~10 s window (header). TESTED.
- Blinding Lights low-level: `bpm 85.54` (half-time), `key A# major (strength 0.61)`. 108 submissions exist. TESTED.
- Quality: the high-level genre/mood models are noisy (another recording got `genre_tzanetakis: jazz` and `ismir04_rhythm: Tango`). Coverage stops at 2022 releases and depends on what users submitted. Use only as a last fallback.

### 3.5 Last.fm — genre and mood tags

- Docs: [track.getTopTags](https://www.last.fm/api/show/track.getTopTags), [artist.getTopTags](https://www.last.fm/api/show/artist.getTopTags), [API ToS](https://www.last.fm/api/tos).
- Lookup: `artist` + `track` (with `autocorrect=1`) or `mbid`. No Spotify ID or ISRC.
- Needs a free API key (no user auth). Without key: `{"message":"Invalid parameters - Your request is missing a required parameter","error":6}`. TESTED.
- Response: `toptags.tag[]` with `name`, `count` (0–100, relative), `url`. DOCS. Tags mix genres ("synthpop", "80s") and moods ("chill", "melancholic", "happy", "party"). Good for mood clustering.
- Terms: **non-commercial only**; must credit Last.fm and link back; must cache per HTTP headers; "Reasonable Usage Cap" of 100 MB stored data. Rate limit not published in the ToS; commonly cited as ~5 req/s per IP (UNVERIFIED). DOCS.
- Fine for a personal app. Not tested live (no key).

### 3.6 Discogs — genres and styles

- Docs: <https://www.discogs.com/developers> (blocked to my fetcher; facts below from live calls).
- `GET https://api.discogs.com/database/search?artist=...&track=...&type=master` → results with `genre[]` and `style[]`. **Works without a token** today; header `x-discogs-ratelimit: 25` (per minute). With a personal token the limit is 60/min (UNVERIFIED from memory; was documented). TESTED.
- Lookup only by artist/title (or barcode/catno). Genres/styles are on releases/masters, not tracks.
- Styles are DJ-friendly and fine-grained (e.g. "Synthwave", "New Wave", "Synth-pop", "Deep House", "Techno"). TESTED.

```text
The Weeknd - Blinding Lights   genre=['Electronic','Pop']  style=['Synthwave','New Wave','Synth-pop']  year=2020
```

- Terms: free for non-commercial use with attribution ("Data provided by Discogs"). UNVERIFIED wording.

### 3.7 Local analysis — Essentia.js (and the audio-source question)

- Package: `essentia.js@0.1.3` on npm, **AGPL-3.0**, last published 2022. WASM build of Essentia. Runs in browser and Node. Has `KeyExtractor`, `RhythmExtractor2013`, `PercivalBpmEstimator`, `Danceability`, `LoudnessEBUR128`, `BeatTrackerMultiFeature`. TESTED (inspected the bundle). [essentia.upf.edu/essentiajs](https://essentia.upf.edu/essentiajs)
- AGPL is fine for a personal local app. It matters only if you distribute or host it for others.
- Lighter MIT options: `meyda` (features, no key detection), `web-audio-beat-detector` (BPM only). Not tested.

**Audio source.** Spotify `preview_url` is effectively gone. The only free, API-delivered audio found is the **Deezer 30 s preview** (`preview` field). The preview CDN allows CORS `*`, so the browser can `fetch` → `decodeAudioData` → Essentia.js without a backend. Legal note: Deezer terms are non-commercial and forbid bypassing DRM to download; previews are not DRM-wrapped. Analysing in memory and keeping only the derived numbers is the low-risk approach. This is a grey area, not an explicit permission.

The other option is the user's own local audio files (if they have them). Fully legal for personal use.

Real test (Node 22, `mpg123-decoder` + Essentia.js, 30 s Deezer previews, ~2.1 s per track):

| Track | Essentia key | Essentia BPM (2013 / Percival) | ReccoBeats/Spotify | Deezer bpm |
|---|---|---|---|---|
| Blinding Lights | F minor (strength 0.91) | 85.4 / 85.4 (half-time) | key 1 major = C♯/D♭ major, 171.0 | 170.84 |
| Mr. Brightside | C♯ major (0.95) | 151.1 / 148.2 | key 1 major = C♯ major, 148.1 | 148.2 |

Takeaways:

- BPM is often reported at half or double time. Always normalise (see §5).
- Key detectors disagree on some tracks. Blinding Lights: Essentia says F minor; Spotify data says D♭ major; AcousticBrainz says A♯ major. Human sources commonly list F minor (UNVERIFIED). Keep a `keySource` and `keyConfidence` per track.

### 3.8 Others

| Service | What | Lookup | Cost | Notes |
|---|---|---|---|---|
| **SoundStat** ([soundstat.info](https://soundstat.info), [OpenAPI](https://soundstat.info/api/v1/openapi.json)) | tempo, key, mode (+confidence), energy, danceability, valence, loudness, beats, segments, genre | **Spotify track ID** (`GET /api/v1/track/{id}`, `x-api-key`) | Paid. Starter $15/mo for 2,000 tracks; pay-per-use $0.01/track (≤5k). Charged once per unique track per 30 days. No free quota listed. | Analyses unknown tracks on demand (returns "processing", SSE status endpoint). Claims >10M tracks (Aug 2026). Without key: `401 {"detail":"API key is required"}` (TESTED). Best paid fallback for key coverage. |
| **Soundcharts** ([audio features API](https://www.soundcharts.com/en/audio-features-api)) | tempo, key, mode, time signature, energy, valence, danceability, ... | UUID, **ISRC**, Spotify/Apple IDs | Paid B2B. Free trial link; prices not public. | Overkill for a personal app. |
| **Cyanite** | AI tagging: genre, mood, BPM, key, energy | Upload audio or Spotify link (UNVERIFIED) | Quote-based; no free plan listed ([SaaSworthy](https://www.saasworthy.com/product/cyanite-ai/pricing), may be outdated) | Not worth it here. |
| **Tunebat** | Key, BPM, Camelot, energy per track (web site) | — | Free website, ads | **No public API** found. Scraping would breach normal site terms. Useful only to manually check values. |
| **Kaggle Spotify datasets** (e.g. "1.2M songs" with audio features) | Historical Spotify features by Spotify ID | Spotify ID (offline CSV) | Free download | Licence and provenance unclear. UNVERIFIED. Possible offline seed cache. |

---

## 4. Comparison table

| Source | BPM | Key/mode | Energy etc. | Genre/mood | Lookup key | Auth | Rate limit | Cost / terms | Browser CORS | 2026 status |
|---|---|---|---|---|---|---|---|---|---|---|
| ReccoBeats | yes | yes | energy, dance, valence, acoustic, instr., speech, live, loudness | no | **Spotify ID** (≤40/batch) | none | unpublished, 429 + Retry-After | free, any use, no warranty | yes | live, TESTED |
| Deezer | yes (`0` = unknown) | no | `gain` only | album genres (coarse) | **ISRC**, Deezer ID, search | none | ~50 req / 5 s (UNVERIFIED) | free, non-commercial | API no, preview CDN yes | live, TESTED |
| Essentia.js on Deezer preview | yes (half/double errors) | yes | danceability, loudness; mood models need TF.js | mood models (optional) | needs audio | — | CPU only | AGPL-3.0 | n/a (local) | lib from 2022, works, TESTED |
| GetSongBPM | yes | yes (+Open Key) | dance, acoustic | artist genres | artist+title search | free key | 3,000/h | free, **backlink mandatory** | yes (`*`) | live (401 w/o key) |
| MusicBrainz | no | no | no | tags + genres (community) | **ISRC**, MBID | none (UA required) | 1 req/s | free, CC0 core | yes | live, TESTED |
| ListenBrainz metadata | no | no | no | recording/release/artist tags | MBID (batch) | none | ~30 / 10 s | free | UNVERIFIED | live, TESTED |
| AcousticBrainz | yes | yes | high-level moods (noisy) | genre models (noisy) | MBID | none | 100 / 10 s | free, CC0 | yes | frozen 2022, API up, TESTED |
| Last.fm | no | no | no | **genre + mood tags** | artist+title, MBID | free key | unpublished (~5/s UNVERIFIED) | free, **non-commercial**, attribution, ≤100 MB cache | UNVERIFIED | live (error 6 w/o key) |
| Discogs | no | no | no | **genres + styles** | artist+title | none (token optional) | 25/min anon, 60/min token | free, attribution | UNVERIFIED | live, TESTED |
| Spotify artist `genres` | no | no | no | artist genres | Spotify artist ID (1 per call) | user token | Spotify limits | Spotify terms | yes | **Deprecated**; Dev-Mode data UNVERIFIED |
| SoundStat | yes | yes (+conf.) | full set | genre | **Spotify ID** | key | per plan | **paid** ($0.005–0.01/track) | UNVERIFIED | live (401 w/o key) |
| Soundcharts / Cyanite | yes | yes | yes | yes | ISRC / audio | key | per plan | **paid**, quote | — | live (not tested) |

---

## 5. Recommended combination

Pipeline per track. Cache every result (IndexedDB in the browser or SQLite in the backend). Never re-fetch known tracks.

1. **Spotify** (user token): read saved tracks and playlists. Keep `id`, `name`, `artists[].id`, `duration_ms`, `external_ids.isrc`. ISRC is available again after the March 2026 revert.
2. **ReccoBeats** `GET /v1/audio-features?ids=` in chunks of 40. Fills `tempo`, `key`, `mode`, `energy`, `danceability`, `valence`, `loudness`, ... Mark source `reccobeats`.
3. For tracks ReccoBeats misses:
   1. **Deezer** `/track/isrc:{isrc}` via the Node backend (throttle to ≤10 req/s). Use `bpm` if > 0.
   2. Fetch the Deezer `preview` (signed URL, use within minutes) and run **Essentia.js** `KeyExtractor` + `RhythmExtractor2013` (+ `Danceability`, `LoudnessEBUR128` as an energy proxy). Do it in a Web Worker or in Node. Keep only numbers.
   3. Optional: send the same preview to ReccoBeats `POST /v1/analysis/audio-features` for `energy`/`valence` (ignore its tempo).
   4. Optional paid fallback: SoundStat by Spotify ID.
4. **Genre/mood tags** (for grouping playlists):
   1. Spotify artist `genres` if the Dev-Mode token still returns them (one call per unique artist, cached).
   2. MusicBrainz `/isrc/{isrc}` → MBID (1 req/s, backend), then ListenBrainz `metadata/recording?inc=tag` in batches.
   3. Last.fm `track.getTopTags` → fallback `artist.getTopTags` for mood words. Credit Last.fm in the UI.
   4. Optional: Discogs `style[]` for electronic sub-genres (house, techno, DnB, ...).
5. **Normalise**:
   - BPM: fold into a target range (e.g. 80–160 for general sets; 120–140 for house/techno) by ×2 or ÷2. Cross-check Deezer vs ReccoBeats vs Essentia; if two agree within 2 %, trust them.
   - Key: convert `(key, mode)` to Camelot. Store `keySource` and `keyConfidence`.
   - Tags: lowercase, merge synonyms ("hip hop" / "hip-hop"), drop noise tags ("seen live", "favorites", years unless wanted).

Why this mix: zero cost, Spotify ID/ISRC lookups only (no fuzzy title matching on the hot path), browser-friendly for ReccoBeats, and every gap has a free fallback.

Risks:

- ReccoBeats is a small free service with no SLA and an unknown data source. It "may shut down without notice". Cache aggressively so the app keeps working.
- Deezer and Last.fm are non-commercial only. Fine for personal use. Re-check if the app ever goes public.
- Key detection disagrees between sources on some tracks. Let the user override key/BPM in the UI.

---

## 6. Harmonic mixing basics

### 6.1 Camelot wheel

- 12 numbers (hours). `A` = minor, `B` = major. Moving +1 is a fifth up. Same number A↔B is the relative major/minor.
- Conversion from Spotify-style `key` (pitch class 0–11, 0 = C) and `mode` (1 major, 0 minor):

```ts
// Major: C=8B, G=9B, D=10B, ... Minor uses its relative major (pc + 3).
function toCamelot(key: number, mode: 0 | 1): { num: number; letter: 'A' | 'B' } {
  const majorPc = mode === 1 ? key : (key + 3) % 12;
  const num = ((7 * majorPc + 7) % 12) + 1; // 1..12
  return { num, letter: mode === 1 ? 'B' : 'A' };
}
// Checks: C maj → 8B, A min → 8A, F min → 4A, C# maj → 3B, E maj → 12B.
```

Full table:

| Camelot | Minor (A) | Major (B) |
|---|---|---|
| 1 | A♭m | B |
| 2 | E♭m | F♯ |
| 3 | B♭m | D♭ |
| 4 | Fm | A♭ |
| 5 | Cm | E♭ |
| 6 | Gm | B♭ |
| 7 | Dm | F |
| 8 | Am | C |
| 9 | Em | G |
| 10 | Bm | D |
| 11 | F♯m | A |
| 12 | C♯m | E |

### 6.2 Compatible moves

- **Same key** (8A → 8A): perfect.
- **±1 same letter** (8A → 7A or 9A): smooth.
- **Relative switch** (8A ↔ 8B): smooth, changes mood.
- Common "extra" moves, used sparingly: +2 (energy boost), diagonal (8A → 9B), +7 (one semitone up, "energy boost").

Key distance for a cost function:

```ts
function keyCost(a: Camelot, b: Camelot): number {
  const d = Math.min(Math.abs(a.num - b.num), 12 - Math.abs(a.num - b.num));
  if (a.letter === b.letter) return d;             // 0 same, 1 neighbour, 2+ clash
  return d === 0 ? 1 : d + 1.5;                    // relative = 1, diagonal ≈ 2.5
}
```

### 6.3 Tempo compatibility

- DJs pitch tracks by up to about ±6–8 %. A step within **~±6 %** blends well; under 3 % is ideal.
- **Half/double time** counts as compatible (85 ↔ 170).
- Without key-lock, a ±6 % pitch change shifts the key by ~1 semitone (= ±7 on the Camelot wheel). Note this if the user mixes without key-lock.

```ts
function bpmCost(a: number, b: number): number {
  const ratios = [b / a, (2 * b) / a, b / (2 * a)];
  const best = Math.min(...ratios.map(r => Math.abs(Math.log(r)))); // symmetric
  return best / Math.log(1.06); // 1.0 == 6 % apart
}
```

### 6.4 Ordering algorithm for a DJ set

Treat it as an open travelling-salesman path over a transition cost, with an energy target curve.

Cost between consecutive tracks `i → j` at set position `p` (0..1):

```text
cost(i, j, p) = wB * bpmCost(i.bpm, j.bpm)
              + wK * keyCost(i.camelot, j.camelot)
              + wE * |j.energy - i.energy|                 // smooth step
              + wT * |j.energy - target(p)|                // follow the arc
              + wD * |j.danceability - i.danceability|     // optional
              + penalty if bpmCost > 1 or keyCost > 2      // hard-ish limits
```

- `target(p)`: energy arc, e.g. warm-up 0.5 → peak 0.85 at p≈0.7 → cool-down 0.6. A piecewise-linear or `sin` curve is enough.
- Suggested start weights: `wB = 1.0, wK = 1.0, wE = 0.5, wT = 1.0`. Expose them as sliders.

Algorithm (simple, fast for a few hundred tracks):

1. **Pick a start**: lowest-energy track in the BPM range, or a user choice.
2. **Greedy nearest neighbour**: from the current track, choose the unused track with the lowest `cost(current, j, p)`. Repeat. O(n²).
3. **Improve with 2-opt** (and optionally "or-opt" moves): reverse a segment if it lowers total cost. Stop when no improvement or after a time budget (~200 ms).
4. Optional: run steps 1–3 from several starts, or use simulated annealing, and keep the best path.
5. Show per-transition badges (ΔBPM %, Camelot move, Δenergy) so the user sees weak links.

For "group my music into playlists", cluster on a feature vector (normalised tempo, energy, valence, danceability, acousticness + tag embeddings/one-hot of top genres) with k-means or HDBSCAN, then sort each cluster with the ordering above.

---

## 7. Sources

- Spotify: [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Feb 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026), [Mar 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/march-2026), [Get Artist](https://developer.spotify.com/documentation/web-api/reference/get-an-artist), [Get Track](https://developer.spotify.com/documentation/web-api/reference/get-track), [developer blog 2026-02-06](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security), [genres thread](https://community.spotify.com/t5/Spotify-for-Developers/Get-Artist-API-is-not-returning-any-or-all-Genres/td-p/6880841)
- ReccoBeats: [intro](https://reccobeats.com/docs/documentation/introduction), [terms](https://reccobeats.com/docs/documentation/terms-of-service), [rate limiting](https://reccobeats.com/docs/documentation/rate-limiting), [audio extraction](https://reccobeats.com/docs/documentation/Analysis/audio-features-extraction), [get audio features](https://reccobeats.com/docs/apis/get-audio-features)
- Deezer: [API](https://developers.deezer.com/api), [terms of use](https://developers.deezer.com/termsofuse), [rate-limit note (third party)](https://next.tangled.org/rocksky.app/rocksky/tree/main/deezer)
- GetSongBPM: [API page](https://getsongbpm.com/api), [Perl client](https://metacpan.org/pod/WebService::GetSongBPM)
- MusicBrainz: [API](https://musicbrainz.org/doc/MusicBrainz_API), [rate limiting](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
- ListenBrainz: [API docs](https://listenbrainz.readthedocs.io/en/latest/users/api/metadata.html)
- AcousticBrainz: [home](https://acousticbrainz.org/), [API docs](https://acousticbrainz.readthedocs.io/api.html)
- Last.fm: [track.getTopTags](https://www.last.fm/api/show/track.getTopTags), [ToS](https://www.last.fm/api/tos)
- Discogs: [developers](https://www.discogs.com/developers)
- Essentia.js: [project page](https://essentia.upf.edu/essentiajs), [paper (TISMIR)](https://transactions.ismir.net/articles/111)
- SoundStat: [site](https://soundstat.info), [OpenAPI](https://soundstat.info/api/v1/openapi.json)
- Soundcharts: [audio features API](https://www.soundcharts.com/en/audio-features-api)
- Cyanite: [SaaSworthy pricing](https://www.saasworthy.com/product/cyanite-ai/pricing)
- Tunebat: [Digital DJ Tips review](https://www.digitaldjtips.com/reviews/tunebat-online-music-database/)
- Alternatives overview: [musiciwant.com](https://musiciwant.com/studio/spotify-audio-features-alternative)
