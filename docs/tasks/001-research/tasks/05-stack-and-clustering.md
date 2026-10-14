# 05 — App stack and playlist-definition (clustering) approach

Research date: 2026-10-13. Machine: macOS, Node v22.21.1, npm 10.9.4.

Scope: local, single-user web app for a personal Spotify account. Features: analyse music, propose new playlists (clusters), find and delete unused playlists, build an ordered DJ playlist.

Notation: **UNVERIFIED** marks a claim that I could not confirm from a primary source or a local test.

## Summary

- Use a **Vite React SPA plus a small Node backend (Hono)**, in one npm-workspaces monorepo.
- The backend holds the Spotify tokens, caches all data in **SQLite**, and runs the long fetch and enrichment jobs.
- Use **better-sqlite3 13.0.3** as the SQLite driver. `node:sqlite` works on Node 22.21.1, but it is still experimental there.
- Register the Spotify redirect URI as `http://127.0.0.1:<port>/...`. Spotify rejects `localhost`.
- Define playlists with a **hybrid**: deterministic features and rules locally, optional clustering to find candidates, and an optional Claude call to name the groups and write rules. The app must work without an API key.
- Test with **Vitest 5.0.4** and **MSW 3.0.3**. MSW 3 changed some option names (see section 3).

## 1. Local architecture

### 1.1 Spotify constraints that affect the architecture

These facts come from Spotify docs. They push the design toward a backend with a cache.

| Constraint | Effect on design | Source |
|---|---|---|
| `localhost` is not allowed as a redirect URI. Use the loopback IP literal `http://127.0.0.1:PORT` or `http://[::1]:PORT`. HTTP is allowed only for loopback. | The app must run on `127.0.0.1`, not `localhost`. Vite defaults to `localhost`, so set `server.host: '127.0.0.1'`. | [Redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) |
| Loopback redirect URIs may use a dynamic port. You can register the URI without a port. | Port changes do not break auth. Still, a fixed port is simpler. | same |
| Implicit grant, HTTP non-loopback redirect URIs and `localhost` aliases were removed on 27 Nov 2025. New apps had the rules from 9 Apr 2025. | Use Authorization Code with PKCE. | [Blog 2025-02-12](https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify), [Blog 2025-10-14](https://developer.spotify.com/blog/2025-10-14-reminder-oauth-migration-27-nov-2025) |
| Development Mode (from 11 Feb 2026 for new apps, 9 Mar 2026 for existing apps): owner needs Premium, max 5 users, smaller endpoint set. | One user is fine. The owner must keep Premium. | [Feb 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [Blog 2026-02-06](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security) |
| Batch fetches were removed in Development Mode: `GET /tracks`, `/albums`, `/artists` (several IDs). Fetch one by one. | Artist enrichment for 1,000+ artists means 1,000+ single calls. This needs a throttled background job and a persistent cache. | same |
| Fields removed: track and album `popularity`, artist `followers` and `popularity`, album `label`. Artist `genres` is not listed as removed. `external_ids` (ISRC) was restored in March 2026. | ISRC is available for cross-referencing to Deezer and MusicBrainz. Do not depend on popularity. | same |
| Playlist `tracks` was renamed to `items`, and the endpoints moved to `/playlists/{id}/items`. Items are returned only for playlists that the user owns or collaborates on. | Followed playlists of other users give metadata only. "Unused playlist" analysis can see contents only for owned playlists. | same |
| Search `limit` max dropped from 50 to 10. | Matching by search is slow. Prefer IDs and ISRC. | same |

Third-party APIs: I tested CORS from origin `http://127.0.0.1:5173` on 2026-10-13.

| API | `Access-Control-Allow-Origin` | Browser call possible? |
|---|---|---|
| Deezer `api.deezer.com/track/{id}` | Header absent (also on preflight) | **No.** Needs a server. |
| Last.fm `ws.audioscrobbler.com/2.0/` | `*` | Yes, but the API key is then exposed in the browser. |
| MusicBrainz `musicbrainz.org/ws/2/` | `*` | Yes, but MusicBrainz asks for a custom `User-Agent` (browsers cannot set it) and 1 req/s. **UNVERIFIED** rate rule, check MusicBrainz docs. |

Deezer note: the track object has `bpm` and `gain` fields. Deezer also supports lookup by ISRC (`/track/isrc:<ISRC>`). In my test the `bpm` value was `0` for a well-known track. So Deezer BPM is often missing. Treat it as optional data.

### 1.2 Option (a): SPA only, PKCE in browser, IndexedDB

How it works: the browser does PKCE, keeps the tokens in IndexedDB or localStorage, calls Spotify directly, and stores the cache in IndexedDB (for example with Dexie).

Pros:
- One process. No server code.
- PKCE in the browser is the flow that Spotify documents for public clients.

Cons:
- Deezer is blocked by CORS. You need a proxy anyway, so you have a server anyway.
- Last.fm and Claude API keys would sit in the browser. The Anthropic SDK can run in a browser only with an explicit opt-in flag. That is not good practice.
- Long jobs (thousands of single-artist calls, throttled for rate limits) stop when the tab closes or sleeps.
- IndexedDB is hard to query for analysis (group by, joins, window functions). SQL is much easier for "unused playlists" and stats.
- The data is hard to inspect or back up outside the browser.

### 1.3 Option (b): Vite React SPA + small Node backend + SQLite (recommended)

How it works:
- The backend runs on `127.0.0.1:8787` (example port). It does the Spotify OAuth (Authorization Code with PKCE; a confidential client can also send the client secret). It stores the access and refresh tokens in SQLite or a local file. The browser never sees the tokens.
- The SPA runs on Vite at `127.0.0.1:5173`. Vite `server.proxy` forwards `/api` and `/auth` to the backend. The browser sees one origin, so there is no CORS setup and the session cookie is same-origin.
- The redirect URI is `http://127.0.0.1:5173/auth/callback` (proxied to the backend) or `http://127.0.0.1:8787/auth/callback` (direct). Pick one and register exactly that string in the Spotify dashboard.
- The backend runs jobs: full library sync, per-artist enrichment, Deezer/Last.fm/MusicBrainz enrichment, Claude calls. A queue (for example `p-queue` 10.0.0) limits concurrency and honours HTTP 429 `Retry-After`.
- The SPA polls job status with TanStack Query, or listens to Server-Sent Events.
- All data lives in one SQLite file. Analysis is plain SQL.

Pros: no CORS problems, keys stay on the server, jobs survive a tab reload, SQL for analysis, easy backup (copy one file), easy to test the server alone.

Cons: two processes in dev. Some more code. Both are small for one user.

**Recommendation: option (b).**

### 1.4 Server framework

| Framework | Version (npm, 2026-10-13) | Notes |
|---|---|---|
| **Hono** + `@hono/node-server` | `hono` 4.13.13, `@hono/node-server` 2.1.5 | Web-standard `Request`/`Response`. Small. Typed RPC client (`hc<AppType>`) gives end-to-end types to the SPA without codegen. `app.request()` lets tests call routes without a socket. Hono 5 is in RC (`5.0.0-rc.1`); stay on 4.x. |
| Fastify | 5.12.7 (6.0.0 is alpha) | Mature, fast, plugin system, JSON-schema validation, `inject()` for tests. More ceremony than this app needs. |
| Express | 5.3.0 | Familiar. Weakest TypeScript story of the three. |

Recommendation: **Hono 4.13.x**. Use `zod` 4.6.7 for request validation (Hono has a zod validator middleware; check the current package name at install time).

### 1.5 SQLite driver on Node 22

I tested both on this Mac (Node v22.21.1) on 2026-10-13.

| Driver | Status on Node 22.21.1 | Bundled SQLite | Notes |
|---|---|---|---|
| `node:sqlite` (built in) | Works without a flag. Prints `ExperimentalWarning: SQLite is an experimental feature`. | 3.50.4 | No install. Synchronous `DatabaseSync` API. Experimental status means the API can change. |
| `better-sqlite3` 13.0.3 | Installed in under 1 s (prebuilt binary), works. `engines: node >=22`. | 3.53.4 | Stable, mature, fast, synchronous API. Native addon, so a Node major upgrade needs a reinstall. |

Recommendation: **better-sqlite3 13.0.3**. Reason: stable API now, no warning, newer SQLite. Keep the DB code behind a small repository module so a later switch to `node:sqlite` is cheap.

Optional query layer: `drizzle-orm` 0.45.4 (supports better-sqlite3) or `kysely` 0.29.6. For a small app, plain SQL with typed helper functions is also fine. Drizzle 1.0 is still beta; the `node:sqlite` driver for Drizzle exists only on beta tags.

### 1.6 Frontend stack and versions

All versions are npm `latest` on 2026-10-13.

| Package | Version | Notes |
|---|---|---|
| `vite` | 8.3.4 | `engines: node ^20.19.0 \|\| >=22.12.0`. OK on 22.21.1. |
| `@vitejs/plugin-react` | 6.1.2 | |
| `react`, `react-dom` | 19.3.0 | |
| `@types/react` | 19.3.0 | |
| `typescript` | see below | |
| `@tanstack/react-query` | 5.104.2 | Server state, polling of job status, cache invalidation after mutations. |
| `@tanstack/react-router` | 1.170.44 | Optional. `react-router` 8.4.0 is the alternative. A small app can use either. |
| `tailwindcss`, `@tailwindcss/vite` | 4.3.3 | Tailwind v4, CSS-first config (`@import "tailwindcss";`). |
| `shadcn` (CLI) | 4.21.4 | `npx shadcn@latest init -t vite`. Components are copied into the repo. |
| `@mantine/core`, `@mantine/hooks` | 9.7.2 | Alternative UI kit. Peer `react ^19.2.0`. |
| `recharts` | 3.10.1 | Optional, for analysis charts. |

TypeScript version:
- `typescript@latest` is **7.0.2** (released 2026-07-08). It is the native (Go) compiler.
- TypeScript 7.0 has no stable programmatic API yet. Tools that import `typescript` (for example `typescript-eslint`, whose peer range is `>=4.8.4 <6.1.0`) do not work with 7.0. Sources say the API is planned for 7.1.
- Vite and Vitest do not need the `typescript` package to transpile. Only type-checking and linting need it.
- Recommendation: use **TypeScript 6.0.3** as `typescript` if you use typescript-eslint. Use 7.0.2 if you lint with Biome (2.5.15) or with no type-aware lint. Microsoft suggests an npm alias to keep 6.x as `typescript` and add 7.x for fast `tsc`. Sources: [InfoQ: TypeScript 7 released](https://infoq.com/news/2026/08/typescript-7-released/), [TypeScript blog](https://devblogs.microsoft.com/typescript/?p=5246).

UI kit choice:
- **shadcn/ui + Tailwind v4** (recommended): you own the component code, good tables (TanStack Table recipe), dialogs, command palette. Good for a dashboard-style tool. More setup.
- **Mantine 9**: more ready-made components (data tables via extensions, notifications, charts). Faster to start. Less control over look.
- Both work. I recommend shadcn/ui because the app is mostly tables, dialogs and lists, and you can change any component.

### 1.7 Monorepo layout (npm workspaces)

```
spotify/
  package.json            # "workspaces": ["apps/*", "packages/*"], root scripts
  tsconfig.base.json
  .env                    # SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, LASTFM_API_KEY, ANTHROPIC_API_KEY (git-ignored)
  apps/
    web/                  # Vite + React SPA
      vite.config.ts      # server.host '127.0.0.1', server.port 5173, server.proxy { '/api', '/auth' -> 127.0.0.1:8787 }
      src/
    server/               # Hono on @hono/node-server
      src/
        index.ts          # serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 8787 })
        auth/             # Spotify OAuth, token refresh
        spotify/          # typed client, pagination, 429 handling
        enrich/           # Deezer, Last.fm, MusicBrainz clients
        jobs/             # sync and enrichment jobs, p-queue
        db/               # better-sqlite3, migrations, repositories
        playlists/        # feature vectors, rules engine, clustering, LLM proposer
      data/app.sqlite     # git-ignored
  packages/
    shared/               # shared types and zod schemas (rule DSL, API DTOs)
```

Bind the server to `127.0.0.1` only, so nothing on the LAN can reach the tokens.

### 1.8 Dev scripts (one command)

Node 22.21.1 runs `.ts` files directly (type stripping). I tested `node t.ts` on this Mac: it works without a flag or warning. So the server needs no build step in dev.

Root `package.json` (sketch):

```json
{
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "concurrently -n web,server -c blue,green \"npm:dev -w apps/web\" \"npm:dev -w apps/server\"",
    "test": "vitest",
    "typecheck": "tsc -b"
  }
}
```

- `apps/web`: `"dev": "vite"`.
- `apps/server`: `"dev": "node --watch --env-file=../../.env src/index.ts"`. Alternative: `tsx watch` (`tsx` 4.23.15) if you use TS features that type stripping does not support (enums, parameter properties, namespaces). Simplest rule: avoid those features (TS `erasableSyntaxOnly`).
- `concurrently` 10.0.6 (`engines: node >=22`). Alternative: `npm-run-all2` 9.0.3 (`run-p`).

Node note: Node 22 is in maintenance LTS. All chosen packages support it. Moving to Node 24 LTS later is low risk. **UNVERIFIED**: exact Node 22 end-of-life date (expected April 2027).

## 2. Playlist definition approaches

Spotify `audio-features`, `audio-analysis` and `recommendations` are deprecated for new apps (since Nov 2024; covered in other research tasks). So "energy", "danceability" and "valence" from Spotify are not available. BPM and key must come from third parties, and coverage is partial.

### 2.1 Available signals

| Signal | Source | Coverage and notes |
|---|---|---|
| Artist genres | Spotify `GET /artists/{id}` (single calls only in Dev Mode) | Often empty for small artists. **UNVERIFIED**: exact share of empty genres. |
| Tags | Last.fm `artist.getTopTags`, `track.getTopTags` | Good coverage for known artists. Noisy (for example "seen live", "favorites"). Needs a stop-list and normalisation. |
| Release year / decade | Spotify album `release_date` | Always present. Remasters and compilations distort it. MusicBrainz first-release date can fix this, but it is slow (1 req/s). |
| BPM | Deezer `track.bpm` (via ISRC lookup) | Often `0` (missing). Other BPM sources are covered in other research tasks. |
| Loudness proxy | Deezer `track.gain` | Present more often than BPM. Weak proxy for "energy". **UNVERIFIED** as an energy signal. |
| Usage | Spotify recently played (last 50), top tracks/artists (3 time ranges), saved dates (`added_at`) | Good for "favourites" and "unused" logic. |
| Duration, explicit flag, added_at | Spotify | Always present. |

Design rule: every feature can be missing. The rules engine and the vectoriser must handle `null`.

### 2.2 Approach (a): rule-based grouping

Examples: "genre/tag contains X", "decade = 1990s", "BPM 120–128", "added in the last 90 days and not in any playlist".

Pros:
- Deterministic, explainable, testable with unit tests.
- No API key, no cost.
- Rules can be saved and re-applied after each sync ("smart playlists").

Cons:
- The user must invent the groups. Tags overlap and are noisy.
- BPM and energy rules miss tracks with no data.

### 2.3 Approach (b): unsupervised clustering

Feature vector per track (or per artist, which is more stable):
- Tag TF-IDF: tags as terms, weighted by Last.fm tag count. Keep the top N tags (for example 200–500). Reduce with SVD/PCA to 20–50 dims, or use the sparse vector with cosine distance.
- Year: scaled (for example (year − 1960) / 70).
- BPM: scaled, plus a "missing" flag. Consider half/double-time folding (for example 70 and 140).
- Optional: Deezer gain, duration.
- Weight each block so tags do not dominate.

JS libraries (npm, 2026-10-13):

| Library | Version | Last publish | Weekly downloads | Notes |
|---|---|---|---|---|
| `ml-kmeans` (mljs) | 7.0.1 | 2026-06 | ~134k | Maintained by Zakodium. k-means with k-means++ init. You must choose k. Use silhouette or elbow to pick k. |
| `hdbscan-ts` | 1.0.17 | 2026-02 | ~35k | TypeScript HDBSCAN. Options `minClusterSize`, `minSamples`. Returns `labels_` (−1 = noise) and `probabilities_`. No k needed. Small project; test on your data. Likely O(n²) memory on a few thousand points (**UNVERIFIED**). |
| `hdbscanjs` | 1.0.12 | 2022-06 | ~1.4k | Unmaintained. Do not use. |
| `density-clustering` | 1.3.0 | 2022-06 | ~884k | DBSCAN, OPTICS, k-means. Old but popular. DBSCAN needs a tuned `eps`. |
| `@saehrimnir/druidjs` | 0.9.0 | 2026-08 | ~3k | Dimensionality reduction: PCA, UMAP, t-SNE, others. Good for a 2D "music map" and for reducing dims before HDBSCAN. Academic project (IEEE VIS 2020). |
| `umap-js` (PAIR) | 1.4.0 | 2024-06 | ~147k | UMAP only. Stable, not updated since 2024. |
| `ml-pca` | 4.1.1 | 2022-11 | — | PCA. Old but simple and works. |

Typical pipeline: TF-IDF → UMAP to 5–10 dims (druidjs or umap-js) → HDBSCAN (hdbscan-ts). Use UMAP to 2 dims only for the visual map.

Pros:
- Finds groups that the user did not think of.
- No API key.

Cons:
- Clusters have no names. A cluster is "a set of IDs", not "90s trip-hop".
- Results depend on weights and parameters. Hard to explain and to tune.
- Not stable between runs (random init) unless you fix a seed.
- Noisy tags give noisy clusters.

A cheap naming step without an LLM: label each cluster with its top 2–3 TF-IDF tags plus its median decade (for example "electronic · house · 2010s"). This is usable but not pretty.

### 2.4 Approach (c): LLM-assisted (Claude API)

How it works:
1. The server builds a **compact summary**, not the full track list. Example content: tag frequency table (top 200 tags with counts), decade histogram, BPM histogram, and a list of top artists with their top 3–5 tags and track counts. Optionally include the cheap cluster labels from 2.3.
2. The server asks Claude to propose N named playlists. Each proposal is a **rule** in a fixed JSON schema (rule DSL), not a list of track IDs.
3. The server validates the rules with zod and applies them locally to all tracks. It shows the match count per proposal. The user accepts, edits, or rejects.
4. Optional second round: send the match counts back and ask Claude to refine rules that match too few or too many tracks.

Example rule DSL (shared zod schema in `packages/shared`):

```ts
const Rule = z.object({
  name: z.string(),                        // "Late-night downtempo"
  description: z.string(),
  includeTagsAny: z.array(z.string()),
  excludeTagsAny: z.array(z.string()),
  decadeFrom: z.number().nullable(),
  decadeTo: z.number().nullable(),
  bpmMin: z.number().nullable(),
  bpmMax: z.number().nullable(),
  artistIds: z.array(z.string()),          // optional seeds
  targetSize: z.number(),
});
const Proposal = z.object({ playlists: z.array(Rule) });
```

SDK usage (`@anthropic-ai/sdk` 0.133.0; peer `zod ^3.25.0 || ^4.0.0`). Use structured outputs with `messages.parse` and `zodOutputFormat`. Source: SDK `helpers.md` via Context7 `/anthropics/anthropic-sdk-typescript`.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';

const client = new Anthropic(); // reads ANTHROPIC_API_KEY on the server

const msg = await client.messages.parse({
  model: 'claude-sonnet-5-5',
  max_tokens: 16000,
  messages: [{ role: 'user', content: promptWithSummary }],
  output_config: { format: zodOutputFormat(Proposal) },
});
const proposal = msg.parsed_output; // typed, validated
```

Important API notes (from the Anthropic `claude-api` reference bundled with Claude Code, cached 2026-10-06):
- Use `output_config: { format }`. The old `output_format` parameter is deprecated.
- On Claude Opus 5.5 and Claude Sonnet 5.5, **forced tool use** (`tool_choice` `{type: 'any'}` or `{type: 'tool'}`) returns HTTP 400. So do not use the old "force a tool to get JSON" pattern. Use structured outputs instead, or `tool_choice: auto` with `strict: true` on the tool.
- Thinking is adaptive by default on these models. `budget_tokens` is rejected. Control depth with `output_config.effort` (`low` … `max`). Opus 5.5 and Haiku 5.5 default to `medium`; Sonnet 5.5 defaults to `high`.
- Always check `stop_reason` (`refusal`, `max_tokens`) before using the output.
- Use streaming (`.stream(...).finalMessage()`) if `max_tokens` is large.

Models and prices (first-party API, per million tokens, from the same reference):

| Model | ID | Context | Input | Output |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | $4.00 | $20.00 |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | $2.00 | $10.00 |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | $0.10 | $0.50 (up to 100K-token prompts; $0.50 / $2.50 above) |

Cost estimate for one proposal call: about 20K input tokens (summary) and 4K output tokens.
- Opus 5.5: about $0.08 + $0.08 = **~$0.16**.
- Sonnet 5.5: about $0.04 + $0.04 = **~$0.08**.
- Haiku 5.5: well under $0.01.
These are estimates. Thinking tokens are billed as output and can raise the cost. Use `count_tokens` to measure the real summary size.

Pros:
- Best names and descriptions ("Sunday morning jazz-funk", "Peak-time 124–128 tech house").
- Uses world knowledge about artists and genres, which fills gaps in tags.
- Rules stay local, explainable and re-runnable. The LLM never sees or edits the library directly.

Cons:
- Needs an Anthropic API key (separate from a Claude.ai subscription) and network access.
- Small cost per run.
- Sends listening data (artist names, tags) to a third party. Fine for personal use, but state it in the UI.
- Output can vary between runs. Rules can reference tags that do not exist in your data; validate against the known tag vocabulary and show "0 matches".

### 2.5 Recommended hybrid

1. **Base layer (always on, no key):** sync, enrichment, feature table in SQLite, and a rules engine that applies the rule DSL. The user can write rules by hand in the UI.
2. **Discovery layer (no key):** TF-IDF + optional UMAP + HDBSCAN (or k-means with chosen k) per artist, then propagate to tracks. Auto-label clusters with top tags and decade. Show them as "suggested groups".
3. **Naming and rule layer (optional key):** if `ANTHROPIC_API_KEY` is set, send the compact summary plus the cluster labels to Claude. Get named playlists as rule DSL via structured outputs. Apply locally and show match counts. Default model: Sonnet 5.5 (good quality, low cost). Allow switching to Opus 5.5 for better results, and Haiku 5.5 for cheap re-runs.
4. **Human in the loop:** nothing is written to Spotify until the user accepts a proposal. Creating playlists and deleting unused ones are explicit actions with a confirmation dialog.

Why this mix:
- The app is fully useful without a key or spend.
- Clustering gives structure; the LLM gives names and readable rules.
- Rules are deterministic, so re-sync and testing are easy.

DJ ordering (out of scope here, but the same feature table serves it): order by BPM steps and key compatibility (Camelot) where data exists. BPM/key coverage depends on the sources chosen in the other research tasks.

## 3. Testing approach

Versions (npm, 2026-10-13):

| Package | Version | Notes |
|---|---|---|
| `vitest` | 5.0.4 | `engines: node ^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`. Peer `vite ^6.4 \|\| ^7 \|\| ^8`. |
| `@vitest/coverage-v8` | 5.0.4 | |
| `msw` | 3.0.3 | Released 3.0.0 on 2026-09-28. ESM only. Node ≥ 22. TypeScript ≥ 5.9. |
| `@testing-library/react` | 16.3.3 | |
| `@testing-library/user-event` | 14.6.8 | |
| `@testing-library/jest-dom` | 7.0.1 | |
| `jsdom` / `happy-dom` | 30.1.2 / 21.0.1 | DOM for web tests. |

Plan:
- **One Vitest config at the root** with two projects (`test.projects`): `server` (environment `node`) and `web` (environment `jsdom`). **UNVERIFIED**: exact Vitest 5 project config shape; check the Vitest docs at setup time.
- **Unit tests (most tests):** rules engine, TF-IDF builder, clustering wrapper (fixed seed), "unused playlist" scoring, DJ ordering. Pure functions. No mocks.
- **Spotify client tests with MSW:** `setupServer` from `msw/node`, handlers from `msw` (`http`, `HttpResponse`). Mock:
  - `POST https://accounts.spotify.com/api/token` (code exchange and refresh).
  - `GET https://api.spotify.com/v1/me/playlists`, `/v1/playlists/:id/items` with paging (`next` URLs), `/v1/artists/:id`.
  - A 429 response with `Retry-After` to test the queue back-off.
  - Deezer and Last.fm endpoints.
  Store JSON fixtures in `apps/server/test/fixtures/` (copied from real responses, with IDs anonymised).
- **Route tests:** call Hono routes with `app.request('/api/...')`. No port needed. MSW intercepts the outgoing Spotify calls.
- **DB tests:** better-sqlite3 with `:memory:` and the real migrations.
- **Web tests:** Testing Library with MSW handlers for `/api/*`, so components and TanStack Query run against realistic responses. MSW 3 also ships a `msw/vite` plugin (new in 3.0); optional.
- **LLM tests:** do not call Claude in CI. Mock `https://api.anthropic.com/v1/messages` with MSW and return a fixed structured response. Test that invalid rules are rejected by the zod schema.

MSW setup (from MSW quick-start via Context7 `/websites/mswjs_io`, adjusted for MSW 3):

```ts
// vitest.setup.ts
import { beforeAll, afterEach, afterAll } from 'vitest';
import { server } from './test/msw/node';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

MSW 3 breaking changes that matter here ([MSW v3.0.0 release](https://github.com/mswjs/msw/releases/tag/v3.0.0)):
- `onUnhandledRequest` is renamed to `onUnhandledFrame`. Most blog posts still show the old name.
- MSW no longer patches `setTimeout` for fake timers. With `vi.useFakeTimers()`, advance timers so `delay()` responses resolve.
- Cookies are not managed in Node. Use the `cookies` resolver argument.
- `delay` and `passthrough` are also exported from `msw/utils`.

## 4. Version table (all npm `latest`, 2026-10-13)

| Area | Package | Version |
|---|---|---|
| Build | vite | 8.3.4 |
| Build | @vitejs/plugin-react | 6.1.2 |
| UI | react / react-dom | 19.3.0 |
| Lang | typescript | 7.0.2 latest; 6.0.3 if typescript-eslint is used |
| Data | @tanstack/react-query | 5.104.2 |
| Routing | @tanstack/react-router / react-router | 1.170.44 / 8.4.0 |
| Styles | tailwindcss / @tailwindcss/vite | 4.3.3 |
| UI kit | shadcn (CLI) | 4.21.4 |
| UI kit alt | @mantine/core | 9.7.2 |
| Server | hono / @hono/node-server | 4.13.13 / 2.1.5 |
| Server alt | fastify / express | 5.12.7 / 5.3.0 |
| DB | better-sqlite3 | 13.0.3 |
| DB alt | node:sqlite (built in, experimental on 22) | SQLite 3.50.4 |
| Query | drizzle-orm / kysely | 0.45.4 / 0.29.6 |
| Validation | zod | 4.6.7 |
| Jobs | p-queue | 10.0.0 |
| LLM | @anthropic-ai/sdk | 0.133.0 |
| Clustering | ml-kmeans / hdbscan-ts | 7.0.1 / 1.0.17 |
| Dim. reduction | @saehrimnir/druidjs / umap-js | 0.9.0 / 1.4.0 |
| Dev | concurrently / tsx | 10.0.6 / 4.23.15 |
| Test | vitest / msw | 5.0.4 / 3.0.3 |
| Test | @testing-library/react | 16.3.3 |
| Lint alt | @biomejs/biome / eslint | 2.5.15 / 10.12.0 |

## 5. Open questions for the next step

- Which BPM/key source to use (Deezer is sparse). See the audio-feature replacement research task.
- Whether `GET /me/tracks` (Liked Songs read) still works in Development Mode after the library endpoint changes. The migration guide lists `/me/tracks` under removed library endpoints, replaced by `/me/library`. **UNVERIFIED**: which read endpoint now returns saved tracks with `added_at`. Check before design.
- Whether to store the Anthropic key in `.env` only, or allow entry in the UI (stored server-side).

## Sources

- Spotify Redirect URIs: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- Spotify blog, 2025-02-12, security requirements: https://developer.spotify.com/blog/2025-02-12-increasing-the-security-requirements-for-integrating-with-spotify
- Spotify blog, 2025-10-14, OAuth migration reminder: https://developer.spotify.com/blog/2025-10-14-reminder-oauth-migration-27-nov-2025
- Spotify February 2026 Dev Mode migration guide: https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- Spotify blog, 2026-02-06, developer access update: https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security
- MSW v3.0.0 release notes: https://github.com/mswjs/msw/releases/tag/v3.0.0
- MSW quick start (Context7 `/websites/mswjs_io`): https://mswjs.io/docs/quick-start
- Anthropic TypeScript SDK helpers (Context7 `/anthropics/anthropic-sdk-typescript`): https://github.com/anthropics/anthropic-sdk-typescript/blob/main/helpers.md
- Claude model IDs, prices, API behaviour: Anthropic `claude-api` skill reference (cached 2026-10-06)
- shadcn/ui Vite install (Context7 `/shadcn-ui/ui`): https://github.com/shadcn-ui/ui/blob/main/apps/v4/content/docs/installation/vite.mdx
- Hono Node adapter and RPC (Context7 `/websites/hono_dev`): https://hono.dev/docs/guides/best-practices
- Vite server options (Context7 `/vitejs/vite`): https://github.com/vitejs/vite/blob/main/docs/config/server-options.md
- TypeScript 7 release: https://infoq.com/news/2026/08/typescript-7-released/ and https://devblogs.microsoft.com/typescript/?p=5246
- npm registry (`npm view <pkg> version engines peerDependencies`) and npm downloads API, queried 2026-10-13
- Local tests on 2026-10-13: `node:sqlite` and better-sqlite3 13.0.3 on Node 22.21.1; Node type stripping; CORS headers of Deezer, Last.fm, MusicBrainz via curl
