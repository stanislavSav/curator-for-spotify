import type { EnrichSourceStatus, EnrichStatus } from '@curator/shared';
import type { DB } from '../../db/db.ts';
import { libraryTrackIds } from '../../db/library.ts';
import { recentJobs } from '../../jobs/jobs.ts';
import { DEFAULT_LIMITS } from './enrich.ts';
import { isGenresStripped, libraryArtists, RETRY_AFTER_DAYS, retryCutoff, taggedEntities } from './store.ts';

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const DAY_MS = 24 * 3600 * 1000;
// Measured on a real run: ~70 % of artists link to Spotify in MusicBrainz and
// cost ~2 s per 100 (batched). The rest cost ~1.7 s each (ISRC + name search).
const MB_LINKED_SHARE = 0.7;
const MB_SLOW_SECONDS = 1.7;

/** Attempts newer than the retry cutoff: id → ok, plus the oldest failed attempt. */
function attempts(db: DB, type: string, source: string, now: Date) {
  const rows = db
    .prepare('SELECT entity_id, ok, attempted_at FROM enrich_attempts WHERE entity_type = ? AND source = ? AND attempted_at > ?')
    .all(type, source, retryCutoff(now)) as { entity_id: string; ok: number; attempted_at: string }[];
  const failed = new Map<string, string>();
  for (const r of rows) if (!r.ok) failed.set(r.entity_id, r.attempted_at);
  return { tried: new Set(rows.map((r) => r.entity_id)), failed };
}

const nextRetry = (failedAt: Iterable<string>) => {
  let min: string | null = null;
  for (const at of failedAt) if (!min || at < min) min = at;
  return min ? new Date(Date.parse(min) + RETRY_AFTER_DAYS * DAY_MS).toISOString() : null;
};

const state = (s: { waiting: number }): EnrichSourceStatus['state'] => (s.waiting > 0 ? 'pending' : 'complete');

/** Where each enrichment source stands, for the Library page. Pure reads, no network. */
export function enrichStatus(db: DB, now = new Date()): EnrichStatus {
  const library = libraryTrackIds(db).filter((id) => SPOTIFY_ID.test(id));
  const features = new Map(
    (db.prepare('SELECT track_id, source, tempo, key FROM audio_features').all() as {
      track_id: string;
      source: string;
      tempo: number | null;
      key: number | null;
    }[]).map((r) => [r.track_id, r]),
  );
  const isrc = new Map(
    (db.prepare('SELECT id, isrc FROM tracks').all() as { id: string; isrc: string | null }[]).map((r) => [r.id, r.isrc]),
  );

  // ReccoBeats
  const recco = attempts(db, 'track', 'reccobeats', now);
  const reccoDone = library.filter((id) => ['reccobeats', 'manual'].includes(features.get(id)?.source ?? ''));
  const reccoDoneSet = new Set(reccoDone);
  const reccoFailed = library.filter((id) => !reccoDoneSet.has(id) && recco.failed.has(id));
  const reccoS: EnrichSourceStatus = {
    id: 'reccobeats',
    label: 'ReccoBeats',
    provides: 'BPM, key, energy, mood',
    unit: 'tracks',
    total: library.length,
    done: reccoDone.length,
    notFound: reccoFailed.length,
    waiting: library.length - reccoDone.length - reccoFailed.length,
    skipped: 0,
    skippedReason: null,
    nextRetryAt: nextRetry(reccoFailed.map((id) => recco.failed.get(id)!)),
    etaMinutes: null,
    state: 'complete',
    note: 'Its catalogue lacks many newer, local and niche releases.',
  };
  reccoS.state = state(reccoS);
  reccoS.etaMinutes = reccoS.waiting ? Math.ceil((reccoS.waiting / 40) * 0.5 / 60) : null;

  // Deezer: only tracks still without BPM after ReccoBeats.
  const deezer = attempts(db, 'track', 'deezer', now);
  const needBpm = library.filter((id) => features.get(id)?.source !== 'reccobeats' && features.get(id)?.source !== 'manual');
  const noIsrc = needBpm.filter((id) => !isrc.get(id));
  const withIsrc = needBpm.filter((id) => isrc.get(id));
  const deezerDone = withIsrc.filter((id) => features.get(id)?.tempo != null);
  const deezerDoneSet = new Set(deezerDone);
  const deezerFailed = withIsrc.filter((id) => !deezerDoneSet.has(id) && deezer.failed.has(id));
  const deezerS: EnrichSourceStatus = {
    id: 'deezer',
    label: 'Deezer',
    provides: 'BPM only, for tracks ReccoBeats does not know',
    unit: 'tracks',
    total: needBpm.length,
    done: deezerDone.length,
    notFound: deezerFailed.length,
    waiting: withIsrc.length - deezerDone.length - deezerFailed.length,
    skipped: noIsrc.length,
    skippedReason: noIsrc.length ? 'no ISRC code from Spotify' : null,
    nextRetryAt: nextRetry(deezerFailed.map((id) => deezer.failed.get(id)!)),
    etaMinutes: null,
    state: 'complete',
    note: 'Deezer often stores BPM as 0 (unknown). It never gives key or energy.',
  };
  deezerS.state = state(deezerS);
  deezerS.etaMinutes = deezerS.waiting ? Math.ceil((deezerS.waiting * 0.2) / 60) : null;

  // Artists (Spotify genres + MusicBrainz)
  const artists = libraryArtists(db).filter((a) => SPOTIFY_ID.test(a.id));
  const stripped = isGenresStripped(db, now);
  const spotifyTagged = taggedEntities(db, 'artist', 'spotify-genre');
  const spotifyTried = attempts(db, 'artist', 'spotify-genre', now).tried;
  const strippedAt = db
    .prepare("SELECT attempted_at FROM enrich_attempts WHERE entity_type = 'meta' AND source = 'spotify-genre'")
    .pluck()
    .get() as string | undefined;
  const genreDone = artists.filter((a) => spotifyTagged.has(a.id)).length;
  const genreTried = artists.filter((a) => spotifyTried.has(a.id) && !spotifyTagged.has(a.id)).length;
  const spotifyS: EnrichSourceStatus = {
    id: 'spotify-genre',
    label: 'Spotify genres',
    provides: 'Artist genres',
    unit: 'artists',
    total: artists.length,
    done: genreDone,
    notFound: stripped ? 0 : genreTried,
    waiting: stripped ? 0 : artists.length - genreDone - genreTried,
    skipped: stripped ? artists.length - genreDone : 0,
    skippedReason: stripped ? 'Spotify returns empty genres to Development Mode apps' : null,
    nextRetryAt: stripped && strippedAt ? new Date(Date.parse(strippedAt) + RETRY_AFTER_DAYS * DAY_MS).toISOString() : null,
    etaMinutes: null,
    state: 'complete',
    note: stripped ? 'Not available for this app. MusicBrainz tags are used instead.' : null,
  };
  spotifyS.state = stripped ? 'unavailable' : state(spotifyS);

  const mb = attempts(db, 'artist', 'musicbrainz', now);
  const mbTagged = taggedEntities(db, 'artist', 'musicbrainz');
  const mbDone = artists.filter((a) => mbTagged.has(a.id)).length;
  const mbFailed = artists.filter((a) => !mbTagged.has(a.id) && mb.failed.has(a.id));
  const mbS: EnrichSourceStatus = {
    id: 'musicbrainz',
    label: 'MusicBrainz',
    provides: 'Artist genre and style tags',
    unit: 'artists',
    total: artists.length,
    done: mbDone,
    notFound: mbFailed.length,
    waiting: artists.length - mbDone - mbFailed.length,
    skipped: 0,
    skippedReason: null,
    nextRetryAt: nextRetry(mbFailed.map((a) => mb.failed.get(a.id)!)),
    etaMinutes: null,
    state: 'complete',
    note: 'Artists linked to their Spotify page are fetched 100 at a time. The rest go one by one (1 request per second), most-played artists first.',
  };
  mbS.state = state(mbS);
  const mbGap = Math.max(1, DEFAULT_LIMITS.mbGapMs / 1000);
  mbS.etaMinutes = mbS.waiting
    ? Math.ceil(((mbS.waiting / 100) * 2 * mbGap + mbS.waiting * (1 - MB_LINKED_SHARE) * MB_SLOW_SECONDS) / 60)
    : null;

  const wd = attempts(db, 'artist', 'wikidata', now);
  const wdTagged = taggedEntities(db, 'artist', 'wikidata');
  const wdDone = artists.filter((a) => wdTagged.has(a.id)).length;
  const wdFailed = artists.filter((a) => !wdTagged.has(a.id) && wd.failed.has(a.id));
  const wdS: EnrichSourceStatus = {
    id: 'wikidata',
    label: 'Wikidata',
    provides: 'Artist genres (well-known artists)',
    unit: 'artists',
    total: artists.length,
    done: wdDone,
    notFound: wdFailed.length,
    waiting: artists.length - wdDone - wdFailed.length,
    skipped: 0,
    skippedReason: null,
    nextRetryAt: nextRetry(wdFailed.map((a) => wd.failed.get(a.id)!)),
    etaMinutes: null,
    state: 'complete',
    note: 'Matched by Spotify artist id, 150 per request. Niche artists are often missing.',
  };
  wdS.state = state(wdS);
  wdS.etaMinutes = wdS.waiting ? Math.ceil(((wdS.waiting / 150) * 2) / 60) : null;

  // Gaps
  const artistTags = new Set(
    db.prepare("SELECT DISTINCT entity_id FROM tags WHERE entity_type = 'artist'").pluck().all() as string[],
  );
  const trackTags = new Set(db.prepare("SELECT DISTINCT entity_id FROM tags WHERE entity_type = 'track'").pluck().all() as string[]);
  const trackArtists = new Map<string, string[]>();
  for (const r of db.prepare('SELECT track_id, artist_id FROM track_artists').all() as { track_id: string; artist_id: string }[]) {
    const list = trackArtists.get(r.track_id);
    if (list) list.push(r.artist_id);
    else trackArtists.set(r.track_id, [r.artist_id]);
  }
  const noBpm = library.filter((id) => features.get(id)?.tempo == null);
  const gaps = {
    tracks: library.length,
    noBpm: noBpm.length,
    noKey: library.filter((id) => features.get(id)?.key == null).length,
    noTags: library.filter((id) => !trackTags.has(id) && !(trackArtists.get(id) ?? []).some((a) => artistTags.has(a))).length,
    noBpmBothNotFound: noBpm.filter((id) => recco.failed.has(id) && deezer.failed.has(id)).length,
    noBpmWaiting: noBpm.filter((id) => !recco.tried.has(id) || (isrc.get(id) && !deezer.tried.has(id))).length,
    noBpmNoIsrc: noBpm.filter((id) => recco.failed.has(id) && !isrc.get(id)).length,
  };

  return {
    retryAfterDays: RETRY_AFTER_DAYS,
    sources: [reccoS, deezerS, spotifyS, mbS, wdS],
    gaps,
    runs: recentJobs('enrich', 6, db),
  };
}
