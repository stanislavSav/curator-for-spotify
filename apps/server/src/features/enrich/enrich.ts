import type { DB } from '../../db/db.ts';
import { libraryTrackIds } from '../../db/library.ts';
import { NotConnectedError } from '../../spotify/auth.ts';
import { SpotifyApiError, type SpotifyClient } from '../../spotify/client.ts';
import { fetchDeezerBpm } from './deezer.ts';
import { HttpError, realSleep, Throttle, type HttpDeps, type Sleep } from './http.ts';
import { matchCredit, MusicBrainz, pickSearchHit, tagsFromCounts, type MbArtist } from './musicbrainz.ts';
import { fetchWikidataGenres, WIKIDATA_BATCH } from './wikidata.ts';
import { fetchReccoBeats, RECCOBEATS_BATCH } from './reccobeats.ts';
import {
  GENRES_STRIPPED,
  isGenresStripped,
  libraryArtists,
  normaliseName,
  normaliseTag,
  recentAttempts,
  recordAttempt,
  replaceTags,
  round2,
  taggedEntities,
} from './store.ts';

export interface EnrichLimits {
  reccoGapMs: number;
  deezerGapMs: number;
  /** Deezer lookups per run (one request per track). */
  deezerMax: number;
  spotifyArtistsMax: number;
  /** If this many artists in a row come back without genres, assume the field is stripped. */
  genreProbe: number;
  mbGapMs: number;
  wikidataGapMs: number;
  mbMax: number;
  mbBudgetMs: number;
}

// No per-run caps by default: one run finishes everything, and Stop (the job
// signal) pauses it. Tests set small caps.
export const DEFAULT_LIMITS: EnrichLimits = {
  reccoGapMs: 300,
  deezerGapMs: 120, // Deezer allows ~50 requests / 5 s
  deezerMax: Infinity,
  spotifyArtistsMax: Infinity,
  genreProbe: 20,
  mbGapMs: 1100, // MusicBrainz allows 1 request / s
  wikidataGapMs: 1000,
  mbMax: Infinity,
  mbBudgetMs: Infinity,
};

export interface EnrichDeps {
  fetch: typeof fetch;
  /** null skips the Spotify genre phase. */
  spotify: SpotifyClient | null;
  sleep?: Sleep;
  now?: () => Date;
  limits?: Partial<EnrichLimits>;
  /** Aborted when the user presses Stop. */
  signal?: AbortSignal;
}

export type Progress = (done: number, total: number, message: string) => void;

interface Env {
  db: DB;
  http: HttpDeps;
  spotify: SpotifyClient | null;
  now: () => Date;
  clock: () => number;
  limits: EnrichLimits;
  progress: Progress;
  signal: AbortSignal;
}

const STOPPED = 'stopped by you; run again to continue';
const STEPS = 6;
const MB_BATCH = 100;

/** "Step 6/6 · MusicBrainz · 38/2140 artists · ~55 min left" */
function stepLine(step: number, name: string, done: number, total: number, unit: string, startedMs: number, nowMs: number) {
  const parts = [`Step ${step}/${STEPS} · ${name}`, `${done.toLocaleString('en')}/${total.toLocaleString('en')} ${unit}`];
  const elapsed = nowMs - startedMs;
  if (done >= 5 && elapsed > 3000) {
    const leftMs = ((total - done) * elapsed) / done;
    parts.push(leftMs < 60_000 ? 'less than a minute left' : `~${Math.round(leftMs / 60_000)} min left`);
  }
  return parts.join(' · ');
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

/**
 * The enrich job. Each phase only does work that is still missing, so the job
 * can be stopped and run again at any time. Failed lookups are retried after
 * RETRY_AFTER_DAYS. Returns a one-line summary per phase.
 */
export async function runEnrich(db: DB, deps: EnrichDeps, progress: Progress = () => {}): Promise<string> {
  const now = deps.now ?? (() => new Date());
  const env: Env = {
    db,
    http: { fetch: deps.fetch, sleep: deps.sleep ?? realSleep },
    spotify: deps.spotify,
    now,
    clock: () => now().getTime(),
    limits: { ...DEFAULT_LIMITS, ...deps.limits },
    progress,
    signal: deps.signal ?? new AbortController().signal,
  };
  const phases: [string, (env: Env) => Promise<string>][] = [
    ['ReccoBeats', reccoBeatsPhase],
    ['Deezer', deezerPhase],
    ['Spotify genres', spotifyGenresPhase],
    ['MusicBrainz (linked)', musicBrainzLinkedPhase],
    ['Wikidata', wikidataPhase],
    ['MusicBrainz', musicBrainzPhase],
  ];
  const summary: string[] = [];
  for (const [name, phase] of phases) {
    if (env.signal.aborted) {
      summary.push(`${name}: not started (${STOPPED}).`);
      continue;
    }
    try {
      summary.push(await phase(env));
    } catch (err) {
      summary.push(`${name}: failed (${err instanceof Error ? err.message : String(err)}).`);
    }
  }
  return summary.join(' ');
}

// ---- a. ReccoBeats ---------------------------------------------------------

async function reccoBeatsPhase({ db, http, now, clock, limits, progress, signal }: Env): Promise<string> {
  const have = new Set(
    db.prepare("SELECT track_id FROM audio_features WHERE source IN ('reccobeats', 'manual')").pluck().all() as string[],
  );
  const recent = recentAttempts(db, 'track', 'reccobeats', now());
  const isrcs = new Map(
    (db.prepare('SELECT id, isrc FROM tracks').all() as { id: string; isrc: string | null }[]).map((r) => [r.id, r.isrc]),
  );
  const todo = libraryTrackIds(db)
    .filter((id) => SPOTIFY_ID.test(id) && !have.has(id) && !recent.has(id))
    .map((id) => ({ id, isrc: isrcs.get(id) ?? null }));
  if (todo.length === 0) return 'ReccoBeats: nothing new.';

  const upsert = db.prepare(
    `INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, danceability, valence, loudness,
       acousticness, instrumentalness, fetched_at)
     VALUES (@trackId, 'reccobeats', @tempo, @key, @mode, @energy, @danceability, @valence, @loudness,
       @acousticness, @instrumentalness, @fetchedAt)
     ON CONFLICT (track_id) DO UPDATE SET source = 'reccobeats', tempo = COALESCE(excluded.tempo, tempo),
       key = excluded.key, mode = excluded.mode, energy = excluded.energy, danceability = excluded.danceability,
       valence = excluded.valence, loudness = excluded.loudness, acousticness = excluded.acousticness,
       instrumentalness = excluded.instrumentalness, fetched_at = excluded.fetched_at
     WHERE audio_features.source != 'manual'`,
  );
  const throttle = new Throttle(limits.reccoGapMs, http.sleep, clock);
  let found = 0;
  let missing = 0;
  let failures = 0;
  let failedBatches = 0;
  const started = clock();
  for (let i = 0; i < todo.length; i += RECCOBEATS_BATCH) {
    if (signal.aborted) return `ReccoBeats: ${found} tracks with features, ${missing} not found, ${todo.length - i} left (${STOPPED}).`;
    const chunk = todo.slice(i, i + RECCOBEATS_BATCH);
    progress(i, todo.length, stepLine(1, 'ReccoBeats audio features', i, todo.length, 'tracks', started, clock()));
    await throttle.wait();
    let result;
    try {
      result = await fetchReccoBeats(http, chunk);
      failures = 0;
    } catch (err) {
      if (++failures >= 3) throw err;
      failedBatches++;
      continue;
    }
    const at = now();
    db.transaction(() => {
      for (const t of chunk) {
        const f = result.get(t.id);
        if (f) {
          upsert.run({ trackId: t.id, ...f, fetchedAt: at.toISOString() });
          found++;
        } else missing++;
        recordAttempt(db, 'track', t.id, 'reccobeats', Boolean(f), at);
      }
    })();
  }
  progress(todo.length, todo.length, 'ReccoBeats: done');
  const failed = failedBatches ? `, ${failedBatches} batches failed (retried next run)` : '';
  return `ReccoBeats: ${found} tracks with features, ${missing} not found${failed}.`;
}

// ---- b. Deezer BPM fallback --------------------------------------------------

async function deezerPhase({ db, http, now, clock, limits, progress, signal }: Env): Promise<string> {
  const library = new Set(libraryTrackIds(db));
  const recent = recentAttempts(db, 'track', 'deezer', now());
  const all = (
    db
      .prepare(
        `SELECT t.id, t.isrc FROM tracks t LEFT JOIN audio_features f ON f.track_id = t.id
         WHERE t.isrc IS NOT NULL AND t.isrc != '' AND (f.track_id IS NULL OR f.tempo IS NULL)`,
      )
      .all() as { id: string; isrc: string }[]
  ).filter((t) => library.has(t.id) && !recent.has(t.id));
  if (all.length === 0) return 'Deezer: nothing new.';
  const todo = all.slice(0, limits.deezerMax);

  const upsert = db.prepare(
    `INSERT INTO audio_features (track_id, source, tempo, fetched_at) VALUES (?, 'deezer', ?, ?)
     ON CONFLICT (track_id) DO UPDATE SET tempo = excluded.tempo, fetched_at = excluded.fetched_at,
       source = CASE WHEN source = 'none' THEN 'deezer' ELSE source END
     WHERE audio_features.tempo IS NULL`,
  );
  const throttle = new Throttle(limits.deezerGapMs, http.sleep, clock);
  let found = 0;
  let failures = 0;
  const started = clock();
  for (const [i, t] of todo.entries()) {
    if (signal.aborted) return `Deezer: BPM for ${found} of ${i} tracks, ${todo.length - i} left (${STOPPED}).`;
    progress(i, todo.length, stepLine(2, 'Deezer BPM fallback', i, todo.length, 'tracks', started, clock()));
    await throttle.wait();
    let result;
    try {
      result = await fetchDeezerBpm(http, t.isrc);
      failures = 0;
    } catch (err) {
      if (++failures >= 5) throw err;
      continue;
    }
    if (result.kind === 'quota') return `Deezer: quota reached after ${i} tracks (${found} BPM found). Run again later.`;
    const at = now();
    if (result.kind === 'bpm') {
      upsert.run(t.id, result.bpm, at.toISOString());
      found++;
    }
    recordAttempt(db, 'track', t.id, 'deezer', result.kind === 'bpm', at);
  }
  progress(todo.length, todo.length, 'Deezer: done');
  const left = all.length - todo.length;
  return `Deezer: BPM for ${found} of ${todo.length} tracks${left > 0 ? `, ${left} left for the next run` : ''}.`;
}

// ---- c. Spotify artist genres -------------------------------------------------

async function spotifyGenresPhase({ db, spotify, now, clock, limits, progress, signal }: Env): Promise<string> {
  if (!spotify) return 'Spotify genres: skipped.';
  if (isGenresStripped(db, now()))
    return 'Spotify genres: skipped, Spotify returned no genres last time (it seems stripped for this app).';
  const recent = recentAttempts(db, 'artist', 'spotify-genre', now());
  const todo = libraryArtists(db)
    .filter((a) => a.genresJson === null && SPOTIFY_ID.test(a.id) && !recent.has(a.id))
    .slice(0, limits.spotifyArtistsMax);
  if (todo.length === 0) return 'Spotify genres: nothing new.';

  const save = db.prepare('UPDATE artists SET genres_json = ?, genres_fetched_at = ? WHERE id = ?');
  let calls = 0;
  let withGenres = 0;
  let errors = 0;
  const started = clock();
  for (const [i, artist] of todo.entries()) {
    if (signal.aborted) return `Spotify genres: ${withGenres} of ${calls} artists have genres, ${todo.length - i} left (${STOPPED}).`;
    progress(i, todo.length, stepLine(3, 'Spotify artist genres', i, todo.length, 'artists', started, clock()));
    let body: { genres?: unknown };
    try {
      body = await spotify.get<{ genres?: unknown }>(`/artists/${artist.id}`);
      errors = 0;
    } catch (err) {
      if (err instanceof NotConnectedError) return 'Spotify genres: skipped, not connected to Spotify.';
      if (!(err instanceof SpotifyApiError)) throw err;
      recordAttempt(db, 'artist', artist.id, 'spotify-genre', false, now());
      if (++errors >= 5) return `Spotify genres: stopped after ${errors} errors in a row (${err.status}).`;
      continue;
    }
    const raw = Array.isArray(body.genres) ? body.genres.filter((g): g is string => typeof g === 'string') : [];
    const tags = [...new Set(raw.map(normaliseTag).filter((t) => t !== null))];
    const at = now();
    db.transaction(() => {
      save.run(JSON.stringify(raw), at.toISOString(), artist.id);
      replaceTags(db, 'artist', artist.id, 'spotify-genre', tags.map((tag) => ({ tag, weight: 1 })));
      recordAttempt(db, 'artist', artist.id, 'spotify-genre', true, at);
    })();
    calls++;
    if (tags.length > 0) withGenres++;
    if (calls === limits.genreProbe && withGenres === 0) {
      recordAttempt(db, GENRES_STRIPPED.type, GENRES_STRIPPED.id, GENRES_STRIPPED.source, false, at);
      return `Spotify genres: empty for the first ${calls} artists, so the field seems stripped for this app. Stopped to save quota.`;
    }
  }
  progress(todo.length, todo.length, 'Spotify genres: done');
  return `Spotify genres: ${withGenres} of ${calls} artists have genres.`;
}

// ---- d. MusicBrainz, batched by Spotify link ---------------------------------
// Many MusicBrainz artists link to their Spotify page. One request maps 100
// Spotify ids to MusicBrainz ids, and one search fetches tags for 100 ids:
// ~2 requests per 100 artists instead of 1–2 per artist. Artists without a link
// are left for the slow per-artist phase (f).

async function musicBrainzLinkedPhase({ db, http, now, clock, limits, progress, signal }: Env): Promise<string> {
  const tagged = taggedEntities(db, 'artist', 'musicbrainz');
  const recent = recentAttempts(db, 'artist', 'musicbrainz', now());
  const todo = libraryArtists(db).filter((a) => SPOTIFY_ID.test(a.id) && !tagged.has(a.id) && !recent.has(a.id));
  if (todo.length === 0) return 'MusicBrainz (linked): nothing new.';

  const mb = new MusicBrainz(http, new Throttle(limits.mbGapMs, http.sleep, clock));
  const started = clock();
  let linked = 0;
  let withTags = 0;
  for (let i = 0; i < todo.length; i += MB_BATCH) {
    if (signal.aborted) return `MusicBrainz (linked): tags for ${withTags} of ${linked} linked artists (${STOPPED}).`;
    progress(i, todo.length, stepLine(4, 'MusicBrainz, 100 artists per request', i, todo.length, 'artists', started, clock()));
    const chunk = todo.slice(i, i + MB_BATCH);
    const links = await mb.linkSpotifyArtists(chunk.map((a) => a.id));
    const artists = await mb.artistsByMbid([...new Set([...links.values()].map((l) => l.mbid))]);
    const at = now();
    db.transaction(() => {
      for (const a of chunk) {
        const link = links.get(a.id);
        if (!link) continue; // no Spotify link in MusicBrainz: phase f tries ISRC and name
        linked++;
        const tags = tagsFromCounts(artists.get(link.mbid)?.tags ?? []);
        if (tags.length) {
          replaceTags(db, 'artist', a.id, 'musicbrainz', tags);
          withTags++;
        }
        // Linked means we know who it is; an untagged artist will not do better by name search.
        recordAttempt(db, 'artist', a.id, 'musicbrainz', tags.length > 0, at);
      }
    })();
  }
  progress(todo.length, todo.length, 'MusicBrainz (linked): done');
  return `MusicBrainz (linked): ${linked} of ${todo.length} artists matched by Spotify link, ${withTags} have tags.`;
}

// ---- e. Wikidata genres ----------------------------------------------------------

async function wikidataPhase({ db, http, now, clock, limits, progress, signal }: Env): Promise<string> {
  const recent = recentAttempts(db, 'artist', 'wikidata', now());
  const todo = libraryArtists(db).filter((a) => SPOTIFY_ID.test(a.id) && !recent.has(a.id));
  if (todo.length === 0) return 'Wikidata: nothing new.';

  const throttle = new Throttle(limits.wikidataGapMs, http.sleep, clock);
  const started = clock();
  let withGenres = 0;
  for (let i = 0; i < todo.length; i += WIKIDATA_BATCH) {
    if (signal.aborted) return `Wikidata: genres for ${withGenres} of ${i} artists (${STOPPED}).`;
    progress(i, todo.length, stepLine(5, 'Wikidata genres', i, todo.length, 'artists', started, clock()));
    const chunk = todo.slice(i, i + WIKIDATA_BATCH);
    const genres = await fetchWikidataGenres(http, throttle, chunk.map((a) => a.id));
    const at = now();
    db.transaction(() => {
      for (const a of chunk) {
        const list = genres.get(a.id) ?? [];
        if (list.length) {
          replaceTags(db, 'artist', a.id, 'wikidata', list.map((tag, k) => ({ tag, weight: round2(Math.max(0.5, 1 - k * 0.1)) })));
          withGenres++;
        }
        recordAttempt(db, 'artist', a.id, 'wikidata', list.length > 0, at);
      }
    })();
  }
  progress(todo.length, todo.length, 'Wikidata: done');
  return `Wikidata: genres for ${withGenres} of ${todo.length} artists.`;
}

// ---- f. MusicBrainz artist tags, one artist at a time ---------------------------

async function musicBrainzPhase({ db, http, now, clock, limits, progress, signal }: Env): Promise<string> {
  const tagged = taggedEntities(db, 'artist', 'musicbrainz');
  const recent = recentAttempts(db, 'artist', 'musicbrainz', now());
  const pending = libraryArtists(db).filter((a) => !tagged.has(a.id) && !recent.has(a.id));
  if (pending.length === 0) return 'MusicBrainz: nothing new.';
  const todo = pending.slice(0, limits.mbMax);
  const todoIds = new Set(todo.map((a) => a.id));

  // Prefer a track where the artist is the only credit: the ISRC then maps to them without guessing.
  const pickTrack = db.prepare(
    `SELECT t.id, t.isrc, (SELECT COUNT(*) FROM track_artists x WHERE x.track_id = t.id) AS n
     FROM track_artists ta JOIN tracks t ON t.id = ta.track_id
     WHERE ta.artist_id = ? AND t.isrc IS NOT NULL AND t.isrc != ''
     ORDER BY n = 1 DESC, ta.position LIMIT 1`,
  );
  const coArtists = db.prepare(
    'SELECT a.id, a.name FROM track_artists ta JOIN artists a ON a.id = ta.artist_id WHERE ta.track_id = ? AND a.id != ?',
  );

  const mb = new MusicBrainz(http, new Throttle(limits.mbGapMs, http.sleep, clock));
  const started = clock();
  const done = new Set<string>();
  let withTags = 0;
  let errors = 0;

  const save = (artistId: string, hit: MbArtist | null) => {
    const tags = hit ? tagsFromCounts(hit.tags) : [];
    db.transaction(() => {
      if (tags.length) replaceTags(db, 'artist', artistId, 'musicbrainz', tags);
      recordAttempt(db, 'artist', artistId, 'musicbrainz', tags.length > 0, now());
    })();
    done.add(artistId);
    if (tags.length) withTags++;
  };

  for (const [i, artist] of todo.entries()) {
    if (done.has(artist.id)) continue;
    const left = pending.length - done.size;
    if (signal.aborted) return `MusicBrainz: tags for ${withTags} of ${done.size} artists, ${left} left (${STOPPED}).`;
    if (clock() - started > limits.mbBudgetMs) {
      return `MusicBrainz: tags for ${withTags} of ${done.size} artists; time limit reached, run again for the rest.`;
    }
    progress(i, todo.length, stepLine(6, 'MusicBrainz one by one (1 request/s)', i, todo.length, 'artists', started, clock()));

    let hit: MbArtist | null = null;
    try {
      const track = pickTrack.get(artist.id) as { id: string; isrc: string; n: number } | undefined;
      if (track) {
        const recordings = await mb.byIsrc(track.isrc);
        hit = matchCredit(recordings, artist.name, track.n);
        // Featured artists on the same recording come for free.
        for (const other of coArtists.all(track.id, artist.id) as { id: string; name: string }[]) {
          if (!todoIds.has(other.id) || done.has(other.id)) continue;
          const want = normaliseName(other.name);
          const credit = recordings.flat().find((c) => normaliseName(c.name) === want);
          if (credit) save(other.id, credit);
        }
      }
      // Name search only when the ISRC gave no match: it costs another second and can pick a namesake.
      if (!hit) hit = pickSearchHit(await mb.searchArtist(artist.name), artist.name);
      errors = 0;
    } catch (err) {
      if (!(err instanceof HttpError) || ++errors >= 5) throw err;
    }
    save(artist.id, hit);
  }
  progress(todo.length, todo.length, 'MusicBrainz: done');
  const left = pending.length - todo.length;
  return `MusicBrainz: tags for ${withTags} of ${done.size} artists${left > 0 ? `, ${left} left for the next run` : ''}.`;
}
