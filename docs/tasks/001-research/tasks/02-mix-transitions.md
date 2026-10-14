# 02 - Spotify Mix (playlist transitions) and API exposure

Research date: 2026-10-13.
Scope: the in-app "Mix" feature for playlists, what the user can configure, and whether a local React/TS app on the Web API can read, write or trigger it.
Primary sources are newsroom.spotify.com, support.spotify.com and developer.spotify.com.
Secondary sources are tech press and Spotify Community threads.
Items marked **UNVERIFIED** could not be confirmed from a primary source.

## Short answer

- The feature is called **Mix** ("mixed playlists"). It launched in beta on **2025-08-19** for Premium users.
- You can only configure transitions **inside the Spotify app**. The Web API, the Web Playback SDK and the playlist object have **no mix or transition fields**.
- Our app can do the **ordering** (BPM/key flow) and create the playlist. The user then taps **Mix** in the Spotify app. Spotify then creates Auto transitions.

## Timeline

| Date | Event | Source |
|---|---|---|
| 2025-08-19 | Mix launches in beta for Premium. You tap Mix, choose Auto or customize. Presets "Fade" and "Rise". Volume, EQ, effects. Waveform and beat data. BPM and Camelot key shown. Rolling out on the mobile app (iOS/Android). Some APAC markets later. | [Newsroom 2025-08-19](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/), [TechCrunch 2025-08-19](https://techcrunch.com/2025/08/19/spotifys-latest-feature-lets-you-add-your-own-transitions-to-playlists) |
| 2025-09-22 | Beta "fully rolled out to all eligible Premium users". "Mixed By" hub with artist playlists (Martin Garrix, PinkPantheress, SOFI TUKKER and others). | [Newsroom 2025-09-22](https://newsroom.spotify.com/2025-09-22/mixed-playlists-debut-martin-garrix-pinkpantheress-sofi-tukker/) |
| 2025-09-24 | Separate feature: Premium catalog in desktop DJ software (rekordbox, Serato, djay), 51 markets. This is not the in-app Mix. | [Newsroom 2025-09-24](https://newsroom.spotify.com/2025-09-24/dj-software-integration-premium/) |
| 2025-12-11 | DJ software: rekordbox and djay also on iOS and Android. | same page, update note |
| 2026-02-25 | **Smart Reorder**: one tap reorders a mixed playlist by BPM and key. Path: Mix > Edit > Smart Reorder. Spotify says 220 million hours of mixed playlists streamed. | [Newsroom 2026-02-25](https://newsroom.spotify.com/2026-02-25/smart-reorder-playlist-mixing/) |
| 2026-05-19 | "Mixing is now rolling out to eligible Premium users on desktop." | [Newsroom 2025-08-19, update note](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/) |
| 2026-07-21 | Engadget how-to: Mix on mobile and desktop apps. Details of the editor (see below). | [Engadget 2026-07-21](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/) |
| 2026-09-15 | DJ software: VirtualDJ, Cross DJ, Edjing Mix added. | [Newsroom 2025-09-24, update note](https://newsroom.spotify.com/2025-09-24/dj-software-integration-premium/) |

No Mix update after 2026-05-19 was found on the newsroom (checked 2026-10-13). No new transition styles were announced in 2026.

---

## 1. What the feature is

- **Name:** "Mix" button on a playlist. Spotify Support calls the result "mixed playlists". ([Support: Mixed playlists](https://support.spotify.com/article/mixed-playlists/))
- **What it does:** adds a transition between every pair of adjacent tracks. Transitions are stored in the playlist. They are not computed live. ([Engadget 2026-07-21](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/))
- **Who can use it:** Premium only. Free users hear a mixed playlist as a normal playlist. ([Support](https://support.spotify.com/article/mixed-playlists/))
- **Which playlists:** only playlists **you created**. Collaborative playlists can be mixed, and collaborators can edit the mix. Not albums, not other users' playlists. Discover Weekly, Daily Mix and Release Radar only after you save them as your own playlist. ([Support](https://support.spotify.com/article/mixed-playlists/), [Engadget](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/))
- **Clients:** mobile (iOS, Android) since 2025-08. Desktop officially from 2026-05-19. Some users reported Mix on Mac/PC already in 2025-09, with large playlists not supported on desktop. ([Community 2025-09-20](https://community.spotify.com/t5/Desktop-Mac/Mix-feature-not-working-for-large-playlists/m-p/7140856), [Community 2025-09-04](https://community.spotify.com/t5/Your-Library/Help-understanding-the-new-MIX-feature/m-p/7117514))
- **Web player (open.spotify.com):** a community user reported no Mix option in the web player. **UNVERIFIED** for today.
- **Regions:** "most eligible Premium users worldwide", some APAC markets later (TechCrunch). SoundGuys lists US, Canada, UK, Ireland, Australia, New Zealand, Sweden "and others". No official market list was found. **UNVERIFIED** in detail.
- **Playback rules:**
  - Mix must be on. Shuffle must be off to hear transitions. ([Engadget](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/))
  - Bluetooth output works. **Spotify Connect plays the playlist without transitions.** ([Support](https://support.spotify.com/article/mixed-playlists/))
  - Turning Mix off on your own playlist turns it off for all listeners. Turning it on again restores the saved transitions.
  - You cannot edit transitions in Offline mode.
- **Not the same as:** the old Crossfade/Automix settings, the AI "DJ" feature, or the DJ-software integration.

**Verdict:** Mix is a Premium, in-app playlist feature (2025-08-19 beta, desktop 2026-05-19, Smart Reorder 2026-02-25). Your description is correct.

---

## 2. Configurable options

### Confirmed by Spotify

| Option | What it does | Source |
|---|---|---|
| Mix on/off | Per playlist. Off = normal playlist for everyone. | [Support](https://support.spotify.com/article/mixed-playlists/) |
| Auto | Spotify picks a transition for every pair. This is the default when you tap Mix. | [Newsroom 2025-08-19](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/) |
| Presets "Fade", "Rise" | Presets that combine volume, effects and EQ. | [Newsroom 2025-09-22](https://newsroom.spotify.com/2025-09-22/mixed-playlists-debut-martin-garrix-pinkpantheress-sofi-tukker/) |
| Volume | Loudness of each track during the transition (usually out-track down, in-track up). | [Support](https://support.spotify.com/article/mixed-playlists/) |
| EQ | Highs, mids and lows of each track during the transition. | [Support](https://support.spotify.com/article/mixed-playlists/) |
| Effects | Currently low-pass and high-pass filters that fade in or out. | [Support](https://support.spotify.com/article/mixed-playlists/) |
| Transition point | Waveform and beat data to find the transition point in each track. | [Newsroom 2025-08-19](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/) |
| Smart Reorder | Reorders tracks by BPM and key. | [Newsroom 2026-02-25](https://newsroom.spotify.com/2026-02-25/smart-reorder-playlist-mixing/) |
| Cover stickers | Mix stickers for the cover (phone only, Mix must be on). | [Support](https://support.spotify.com/article/mixed-playlists/) |

### From press and users (secondary)

- **"Blend" preset** - TechCrunch and Music Business Worldwide name "fade, rise or blend". Likely correct.
- **Full preset list** (LETT Music guide, updated 2025-11, single source, **UNVERIFIED**):
  - Auto - Spotify picks a style from key, tempo and other data.
  - Custom - your saved settings.
  - Fade - standard crossfade, bass swap near the middle.
  - Rise - overlap, bass swap at the end, low-pass on the incoming track, high-pass on the outgoing track.
  - Blend - overlap with a smooth 3-band EQ fade.
  - Wave - overlap, bass swap at the centre, low-pass in and out.
  - Melt - fade in/out, bass swap at the centre, high-pass in and out.
  - Slam - hard volume swap at the centre.
  ([LETT Music](https://www.lettmusic.com/blog/how-to-arrange-spotify-playlists))
- **Editor layout** (Engadget 2026-07-21):
  - Tap the "Auto" label between two songs to open the panel.
  - Zoomed waveforms of both tracks. Drag each waveform to set where the transition happens. Beat markers on many songs. An overview waveform above it scrubs the tracks.
  - Three effect lanes: **Volume, EQ, Filter**. Each has 7 to 9 presets.
  - On mobile, "Customize" in a preset menu lets you edit the **curves** in detail. Desktop support for curve editing is not stated.
  - Save (top right). X + Discard reverts.
  ([Engadget](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/))
- **Length:** a "Bars" choice exists only when Spotify detects a clear beat grid. LETT says 2, 4 or 8 bars. A community user saw 12, 4 and 2 bars, and some transitions with no bars. Spotify has not documented the rule. **UNVERIFIED** exact values. ([Community 2025-09-04](https://community.spotify.com/t5/Your-Library/Help-understanding-the-new-MIX-feature/m-p/7117514), [LETT](https://www.lettmusic.com/blog/how-to-arrange-spotify-playlists))
- **Start/end points are limited.** A user could move the incoming track freely but the outgoing track snapped back to the Auto position. Another user still reported this in 2026-08. LETT also says waveforms snap back to the nearest valid position. You cannot start a transition anywhere you like. ([Community 2025-09-16 / 2026-08-27](https://community.spotify.com/t5/Android/Mix-Feature-Bug-Not-Working-Properly/m-p/7182402))
- **Last-to-first loop transition:** disputed. A moderator said there is no option for it. A US user said it existed. **UNVERIFIED.** ([Community 2026-05](https://community.spotify.com/t5/Android/Transitions-not-saving-in-Edit-Playlist-mode/td-p/7425788))
- **Playlist size:** no documented cap. A moderator says to keep playlists "within the lower range". Desktop hid Mix for large playlists in 2025-09. ([Community 2025-10-02](https://community.spotify.com/t5/Your-Library/Max-amount-of-songs-that-can-use-mix/td-p/7158839))
- **No** numeric controls for transition length in seconds, no key shift, no tempo/pitch change, and no stems were found in any source.

**Verdict:** Auto, presets (Fade, Rise, likely Blend, maybe Wave/Melt/Slam), volume, 3-band EQ, low/high-pass filter, waveform alignment, sometimes bar length, curve editing on mobile, Smart Reorder. Exact preset list and length values are **UNVERIFIED**.

---

## 3. API exposure

### Web API

- The playlist object has `collaborative, description, external_urls, href, id, images, name, owner, public, snapshot_id, items`. Playlist items have `added_at, added_by, is_local, item`. **No mix, mixed or transition field.** ([Get Playlist reference](https://developer.spotify.com/documentation/web-api/reference/get-playlist))
- Changelogs for February, March, May and July 2026 do not mention mix, transitions or crossfade. July 2026 is the latest month listed. ([Feb](https://developer.spotify.com/documentation/web-api/references/changes/february-2026), [May](https://developer.spotify.com/documentation/web-api/references/changes/may-2026), [Jul](https://developer.spotify.com/documentation/web-api/references/changes/july-2026))
- Audio features and audio analysis (tempo, key, beats, sections) are blocked for new and dev-mode apps since 2024-11-27. ([Blog 2024-11-27](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api))
- A developer asked Spotify on 2026-04-26 to "Expose Mix / Transition Controls in Spotify Web API". No staff reply was found. This confirms that it does not exist. ([Community 2026-04-26](https://community.spotify.com/t5/Spotify-for-Developers/Expose-Mix-Transition-Controls-in-Spotify-Web-API/m-p/7418126))

### Web Playback SDK and Connect

- The SDK makes the browser a Spotify Connect device. Spotify Support says Connect plays mixed playlists **without transitions**. So our in-app player will **not** play the mix. Inference from Support text, not tested. ([Support](https://support.spotify.com/article/mixed-playlists/))
- The Web API "start playback" call is also a Connect command. Whether a phone that plays its own mixed playlist keeps the transitions when the API starts it is **UNVERIFIED**.

### Undocumented / internal endpoints

- No GitHub project was found that reads or writes Mix transitions. Searches: repos, issues and code for "mixed playlist", "transitions", spclient, librespot, spicetify (2026-10-13).
- librespot issue #1592 (2025-09-21) asks for Mix support. Still open. No implementation and no protocol notes. ([librespot #1592](https://github.com/librespot-org/librespot/issues/1592))
- Reverse engineering the private client API would break the Developer Terms and could get the account or app blocked. Not recommended.

**Verdict:** **Not possible via any public API.** Our app cannot read, create, edit or toggle transitions. It cannot play them through the Web Playback SDK either.

---

## 4. Workarounds

### Recommended flow

1. Our app picks tracks and orders them for a smooth BPM/key/energy flow.
2. Our app creates the playlist on the user's account (`POST /me/playlists`, then add items). The user is the owner, so it is "a playlist you created". Mix should be available. **UNVERIFIED** by test, but it matches the Support rule.
3. Our app shows a "Open in Spotify" link (`https://open.spotify.com/playlist/{id}` or `spotify:playlist:{id}`).
4. The user taps **Mix** in the Spotify mobile or desktop app. Spotify creates Auto transitions for every pair.
5. Optional: the user edits single transitions or presets in the app.
6. The user plays it on the phone or desktop app (or Bluetooth), shuffle off. Not through Connect.

### Answers

- **Can Mix be applied to any playlist the user owns?** Yes, any playlist the user created, plus collaborative playlists. Not to playlists owned by others. Very large playlists may not work well, mainly on desktop.
- **Does Auto choose transitions automatically?** Yes. Tapping Mix gives every pair an Auto transition. Spotify says it uses BPM, key and track structure. Length and style vary even between similar songs.
- **Does our order matter?** Yes. Transitions are made between **adjacent** tracks, so our order defines the pairs. Two cautions:
  - Smart Reorder can replace our order with Spotify's BPM/key order. It can keep tracks with custom transitions in place and only move tracks with Auto transitions. ([SoundGuys 2026-03-02](https://www.soundguys.com/spotify-introduces-smart-reorder-153795/))
  - A moderator says reordering tracks can reset custom transitions to Auto. So our app **must not reorder or rewrite** a playlist after the user has customized the mix. Create a new playlist instead. (Community search snippet, **UNVERIFIED** wording.)
- **Is there a deep link into Mix or edit mode?** None found. Spotify documents only content links (`spotify:playlist:...`, `open.spotify.com/playlist/...`). They open the playlist page. The user must tap Mix. ([iOS content linking](https://developer.spotify.com/documentation/ios/tutorials/content-linking))
- **Can our app check if a playlist is mixed?** No. There is no field for it.
- **Can the app give a "pre-mix" in its own player?** Not with Spotify audio. The Web Playback SDK gives no access to the audio stream and no crossfade control. A fake crossfade by changing volume at the end of each track is possible, but it is not a real mix and it is Connect playback.

**Verdict:** The workable plan is "our app orders and creates the playlist, the user taps Mix in Spotify". Order matters. Do not edit the playlist after the user customizes it. No deep link to Mix.

---

## 5. What Spotify's BPM/key display gives that we cannot get

- **BPM and key for every track**, in standard and **Camelot** notation (1-12, A = minor, B = major). Shown when Mix is on and in the Edit view. ([Engadget](https://www.engadget.com/2216279/how-to-use-spotify-mix-tool/), [Newsroom 2025-08-19](https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/))
- **Beat grid and waveform** (beat markers, structure) used to place transitions.
- **Spotify's own compatibility logic** (Smart Reorder by BPM and key, Auto preset choice).
- Our dev-mode app cannot get any of this from Spotify. Audio features and audio analysis are blocked since 2024-11-27. There is no API for the Mix data.
- **Alternatives** (other research tasks should verify):
  - ReccoBeats API: Spotify-style features with tempo, looked up by Spotify ID. Key may be missing. Coverage is reported as uneven. **UNVERIFIED.** ([apis.io listing](https://apis.io/apis/reccobeats/reccobeats-audio-features-api/))
  - GetSongBPM, Deezer track `bpm`, or local analysis (Essentia) on audio we own. **UNVERIFIED** here.
- Practical idea: the user can read BPM/key in Spotify's Mix view and type it into our app. This is manual and slow, but it uses Spotify's values.

**Verdict:** Spotify shows per-track BPM, Camelot key and beat grid only inside the app. Our app must get BPM/key from a third party or from manual input.

---

## Known bugs (relevant for user expectations)

- Transitions sometimes not timed correctly on the first play. Staff said a fix would come in app version 9.1.2. ([Community: Transitions don't play correctly](https://community.spotify.com/t5/Your-Library/Transitions-don-t-play-correctly/td-p/7119853))
- Custom transitions, effects and EQ are sometimes forgotten (iOS, 2026-05). ([Community 2026-05-07](https://community.spotify.com/t5/iOS-iPhone-iPad/Mix-Feature-Forgets-Custom-Transitions-Effects-amp-EQ-Settings/td-p/7428859))
- Transitions edited inside "Edit playlist" mode reset to Auto. Smart Reorder result does not save (app 9.1.46, 2026-05). ([Community 2026-05](https://community.spotify.com/t5/Android/Transitions-not-saving-in-Edit-Playlist-mode/td-p/7425788))
- Short glitch or pause at transitions, still reported in 2026-07. ([Community](https://community.spotify.com/t5/Android/Mix-Feature-Bug-Not-Working-Properly/m-p/7182402))

## Other sources used

- [Music Business Worldwide](https://www.musicbusinessworldwide.com/spotify-launches-custom-playlist-transitions-to-compete-with-apples-automix/) - presets fade, rise, blend.
- [RouteNote on Smart Reorder](https://routenote.com/blog/spotify-smart-reorder-feature/)
- [dig dis! 2025-10-03](https://digdis.de/en/blog/post/spotify-mix-feature-design-your-own-dj-transitions-for-playlists)
- [Spotify Support: Mixed playlists](https://support.spotify.com/article/mixed-playlists/)
