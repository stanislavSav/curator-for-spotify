// Seeds a fake but believable Library into a demo data folder (data/demo by
// default): the DB, a built Snapshot, a proposals file and one Backup. The RNG
// is seeded, and every date is relative to `now`, so the same `now` gives the
// same data and Prune / Enrich always look current.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PlaylistBackup, ProposalsFile } from '@curator/shared';
import { openDb, ROOT_DIR, type DB } from '../db/db.ts';
import { seededRng } from '../features/dj/rng.ts';
import { buildSnapshot, snapshotSummary, writeSnapshot } from '../features/enrich/snapshot.ts';
import { GENRES_STRIPPED } from '../features/enrich/store.ts';
import { SAMPLE_PROPOSALS } from '../features/proposals/fixtures/seed.ts';
import { writeBackup } from '../features/prune/prune.ts';
import { catalog, GENRES, type CatalogTrack, type GenreId } from './catalog.ts';

export const DEMO_SEED_VERSION = 1;
export const DEMO_MARKER = 'demo-seed.json';
export const DEMO_USER = { id: 'demo', displayName: 'Demo listener' } as const;

export interface DemoSeedResult {
  tracks: number;
  artists: number;
  liked: number;
  playlists: { owned: number; followed: number; generated: number; removed: number };
  recentPlays: number;
  historyRows: number;
  proposals: number;
  snapshotTracks: number;
}

const DAY = 86_400_000;
const pad = (n: number, width: number) => String(n).padStart(width, '0');
const isoSec = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const fixture = (n: number) => `fixture${pad(n, 15)}`;
const monthsAgo = (now: number, months: number) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.getTime();
};

/** Tracks the sample "Rediscover" Proposal promises: liked before 2020, not in any Owned Playlist, no plays for 12 months. */
const REDISCOVER = [1, 3, 5, 8, 9, 18, 19, 21, 22, 25, 27, 28, 31, 32, 33, 34, 36, 38, 39, 43, 46, 48, 50, 51].map(fixture);

interface PlaylistPlan {
  name: string;
  description: string;
  kind: 'owned' | 'followed' | 'generated';
  owner?: { id: string; name: string };
  tracks: string[];
  /** Window for item added_at dates, as epoch ms. */
  added?: [number, number];
  /** Tracks that only live here and should look unplayed for 12+ months. */
  staleExclusive?: string[];
  /** Last play of its Exclusive Tracks (epoch ms). Before the Streaming History starts = never played. */
  lastPlay?: number;
  itemsTotal?: number;
  collaborative?: boolean;
  public?: boolean;
}

/** Reseed after this many days, so Prune and Enrich dates stay current. */
export const DEMO_MAX_AGE_DAYS = 30;

/**
 * Makes sure `dir` holds a current demo Library: seeds it when empty, reseeds it
 * when the seed is old. Refuses the real data folder and any folder with a
 * Library the seed did not make. Returns the counts when it seeded, else null.
 */
export function ensureDemoData(dir: string, now: Date = new Date()): DemoSeedResult | null {
  const target = resolve(dir);
  if (target === resolve(ROOT_DIR, 'data'))
    throw new Error('Demo mode needs its own data folder. Start it with npm run demo, or set CURATOR_DATA_DIR.');
  const marker = resolve(target, DEMO_MARKER);
  if (existsSync(marker)) {
    const info = JSON.parse(readFileSync(marker, 'utf8')) as { version?: number; seededAt?: string };
    const ageDays = (now.getTime() - Date.parse(info.seededAt ?? '')) / DAY;
    if (info.version === DEMO_SEED_VERSION && ageDays >= 0 && ageDays < DEMO_MAX_AGE_DAYS) return null;
    rmSync(target, { recursive: true, force: true });
  } else if (existsSync(resolve(target, 'curator.sqlite'))) {
    throw new Error(`${target} holds a Library that the demo seed did not make. Use an empty folder for demo mode.`);
  }
  return seedDemo(target, now);
}

/** Seeds `dir` (must not hold a Library yet). Returns counts for logs and tests. */
export function seedDemo(dir: string, now: Date = new Date()): DemoSeedResult {
  mkdirSync(dir, { recursive: true });
  const db = openDb(resolve(dir, 'curator.sqlite'));
  try {
    if ((db.prepare('SELECT COUNT(*) FROM tracks').pluck().get() as number) > 0)
      throw new Error(`${dir} already holds a Library. Delete the folder to seed again.`);
    return seedInto(db, dir, now);
  } finally {
    db.close();
  }
}

function seedInto(db: DB, dir: string, nowDate: Date): DemoSeedResult {
  const now = nowDate.getTime();
  const rng = seededRng(20261014);
  const between = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)]!;
  const r2 = (n: number) => Math.round(n * 1000) / 1000;

  const tracks = catalog();
  const byId = new Map(tracks.map((t) => [t.id, t]));
  const byTitle = new Map(tracks.map((t) => [t.name, t.id]));
  const x = (title: string) => {
    const id = byTitle.get(title);
    if (!id) throw new Error(`Demo catalog has no track "${title}"`);
    return id;
  };

  // ---- artists, albums, tracks ----------------------------------------------------
  const artistIds = new Map<string, string>();
  const artistGenre = new Map<string, GenreId>();
  for (const t of tracks)
    for (const a of t.artists)
      if (!artistIds.has(a)) {
        artistIds.set(a, `fixtureartist${pad(artistIds.size + 1, 9)}`);
        artistGenre.set(a, t.genre);
      }
  const albumIds = new Map<string, string>();
  const albumId = (t: CatalogTrack) => {
    const key = `${t.album}|${t.artists[0]}`;
    if (!albumIds.has(key)) albumIds.set(key, `fixturealbum${pad(albumIds.size + 1, 10)}`);
    return albumIds.get(key)!;
  };
  // A few tracks without an ISRC, like local files or odd releases.
  const noIsrc = new Set([fixture(89), x('Supernature'), x('Between the Bars')]);

  const insArtist = db.prepare('INSERT INTO artists (id, name, genres_json, genres_fetched_at) VALUES (?, ?, ?, ?)');
  const insTrack = db.prepare(
    'INSERT INTO tracks (id, uri, name, duration_ms, isrc, album_id, album_name, release_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insTa = db.prepare('INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)');

  // ---- enrichment: features, tags, attempts ---------------------------------------
  const insFeat = db.prepare(
    `INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, danceability, valence, loudness,
       acousticness, instrumentalness, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insTag = db.prepare('INSERT OR IGNORE INTO tags (entity_type, entity_id, source, tag, weight) VALUES (?, ?, ?, ?, ?)');
  const insAttempt = db.prepare(
    'INSERT OR REPLACE INTO enrich_attempts (entity_type, entity_id, source, attempted_at, ok) VALUES (?, ?, ?, ?, ?)',
  );
  const enrichAt = () => new Date(now - between(2.2, 3) * DAY).toISOString();
  const stats = { recco: 0, reccoMissing: 0, deezer: 0, deezerMissing: 0, mb: 0, mbMissing: 0, wd: 0, wdMissing: 0 };

  db.transaction(() => {
    let probe = 0;
    for (const [name, id] of artistIds) {
      // Development Mode apps get empty genres: the first artists were probed, then the phase stopped.
      const probed = probe++ < 20;
      insArtist.run(id, name, probed ? '[]' : null, probed ? enrichAt() : null);
      if (probed) insAttempt.run('artist', id, 'spotify-genre', enrichAt(), 1);
    }
    insAttempt.run(GENRES_STRIPPED.type, GENRES_STRIPPED.id, GENRES_STRIPPED.source, enrichAt(), 0);

    let isrcSeq = 0;
    for (const t of tracks) {
      const isrc = noIsrc.has(t.id) ? null : `ZZDEM${pad(t.year % 100, 2)}${pad(++isrcSeq, 5)}`;
      insTrack.run(t.id, `spotify:track:${t.id}`, t.name, t.durationMs, isrc, albumId(t), t.album, String(t.year));
      t.artists.forEach((a, i) => insTa.run(t.id, artistIds.get(a)!, i));

      const g = GENRES[t.genre];
      const reccoKnows = t.bpm !== null && rng() > 0.09;
      if (reccoKnows) {
        insFeat.run(
          t.id, 'reccobeats', r2(t.bpm! + between(-0.4, 0.4)), t.key, t.mode, t.energy,
          r2(between(...g.dance)), r2(between(...g.valence)), r2(between(...g.loudness)),
          r2(between(...g.acoustic)), r2(between(...g.instr)), enrichAt(),
        );
        insAttempt.run('track', t.id, 'reccobeats', enrichAt(), 1);
        stats.recco++;
        continue;
      }
      insAttempt.run('track', t.id, 'reccobeats', enrichAt(), 0);
      stats.reccoMissing++;
      if (!isrc) continue;
      // Deezer knows the BPM of about half of what ReccoBeats misses.
      const deezerKnows = t.bpm !== null && rng() < 0.55;
      if (deezerKnows) {
        insFeat.run(t.id, 'deezer', t.bpm, null, null, null, null, null, null, null, null, enrichAt());
        stats.deezer++;
      } else stats.deezerMissing++;
      insAttempt.run('track', t.id, 'deezer', enrichAt(), deezerKnows ? 1 : 0);
    }

    // Artist tags. Fixture artists keep the tags of their fixture tracks.
    const fixtureTags = new Map<string, string[]>();
    const sample = JSON.parse(readFileSync(new URL('../features/proposals/fixtures/library.sample.json', import.meta.url), 'utf8')) as {
      tracks: { artists: string[]; tags: string[] }[];
    };
    for (const t of sample.tracks)
      for (const a of t.artists) fixtureTags.set(a, [...new Set([...(fixtureTags.get(a) ?? []), ...t.tags])]);

    // MusicBrainz misses mostly featured artists, rarely a lead artist.
    const leads = new Set(tracks.map((t) => t.artists[0]));
    for (const [name, id] of artistIds) {
      const g = GENRES[artistGenre.get(name)!];
      if (rng() < (leads.has(name) ? 0.97 : 0.6)) {
        const tags = fixtureTags.get(name) ?? [g.tags[0]!, ...g.tags.slice(1).filter(() => rng() < 0.6)];
        tags.forEach((tag, i) => insTag.run('artist', id, 'musicbrainz', tag, Math.max(0.2, 1 - i * 0.2)));
        insAttempt.run('artist', id, 'musicbrainz', enrichAt(), 1);
        stats.mb++;
      } else {
        insAttempt.run('artist', id, 'musicbrainz', enrichAt(), 0);
        stats.mbMissing++;
      }
      if (rng() < 0.74) {
        insTag.run('artist', id, 'wikidata', g.tags[0]!, 1);
        if (rng() < 0.5) insTag.run('artist', id, 'wikidata', g.tags[1]!, 1);
        insAttempt.run('artist', id, 'wikidata', enrichAt(), 1);
        stats.wd++;
      } else {
        insAttempt.run('artist', id, 'wikidata', enrichAt(), 0);
        stats.wdMissing++;
      }
    }
  })();

  // ---- playlists ------------------------------------------------------------------
  const y = (iso: string) => Date.parse(iso);
  const plans: PlaylistPlan[] = [
    {
      name: 'Indie Mix', description: 'Guitars, mostly 2000s.', kind: 'owned', public: true,
      tracks: [2, 4, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 20].map(fixture).concat(
        ['Song 2', 'Buddy Holly', 'The Less I Know the Better', 'Here Comes Your Man', '1979', 'Alright', 'Girls & Boys'].map(x),
      ),
      added: [y('2019-02-01'), now - 21 * DAY],
    },
    {
      name: 'Late Night', description: '', kind: 'owned',
      tracks: [83, 84, 90, 91, 92, 94, 98, 78, 79].map(fixture).concat(['Hallelujah', 'Between the Bars'].map(x)),
      added: [y('2018-05-01'), now - 40 * DAY],
    },
    {
      name: 'Focus', description: 'No words, low energy.', kind: 'owned',
      tracks: [85, 86, 87, 88, 89, 95, 96, 97, 100].map(fixture),
      added: [y('2020-01-10'), now - 55 * DAY],
    },
    {
      name: 'Chill Finds', description: 'Things I want to listen to properly.', kind: 'owned',
      tracks: [93, 99, 76].map(fixture).concat(['Riders on the Storm', 'Royals', 'Fake Plastic Trees', 'Linger', 'Wish You Were Here'].map(x)),
      added: [monthsAgo(now, 26), monthsAgo(now, 20)],
      staleExclusive: [fixture(99), ...['Riders on the Storm', 'Fake Plastic Trees', 'Linger'].map(x)],
      lastPlay: monthsAgo(now, 19),
    },
    {
      name: 'House Selects', description: 'Warm, 118–126 BPM.', kind: 'owned', public: true,
      tracks: [23, 24, 26, 29, 30, 35, 37, 40, 41, 42].map(fixture).concat(
        ['Hypnotized', 'Delorean Dynamite', 'Tieduprightnow', 'Spotlight', "Murphy's Law", 'One More Time', 'Digital Love'].map(x),
      ),
      added: [y('2022-09-01'), now - 6 * DAY],
    },
    {
      name: 'Sunday Records', description: '', kind: 'owned',
      tracks: [64, 66, 68, 70, 71, 75, 76, 80, 82].map(fixture).concat(['Virtual Insanity', 'Forget Me Nots', "Ain't Nobody"].map(x)),
      added: [y('2019-06-01'), now - 34 * DAY],
    },
    {
      name: 'Gym 2019', description: '', kind: 'owned',
      tracks: [
        "Don't Start Now", 'bad guy', 'Song 2', 'Back in Black', 'Highway to Hell', 'Basket Case', 'Everlong', 'Feel So Close',
        'We Found Love', 'Uptown Funk', 'Bad Romance', 'Smells Like Teen Spirit', "Can't Feel My Face", 'Run Away With Me',
        'The Mother We Share',
      ].map(x).concat([fixture(7)]),
      added: [y('2019-01-07'), y('2019-11-20')],
      staleExclusive: ['Back in Black', 'Highway to Hell', 'Basket Case', 'Feel So Close', 'Bad Romance', 'Smells Like Teen Spirit'].map(x),
      lastPlay: monthsAgo(now, 31),
    },
    {
      name: "Road Trip '21", description: 'Coast to coast, July 2021.', kind: 'owned',
      tracks: [
        'Dreams', 'Go Your Own Way', 'The Chain', 'Sweet Home Alabama', 'Fortunate Son', 'Have You Ever Seen the Rain', 'Born to Run',
        'More Than a Feeling', "Free Fallin'", 'Hotel California', 'Tiny Dancer', 'The Boys Are Back in Town', 'Sultans of Swing',
        "Baba O'Riley", 'Start Me Up', 'Life on Mars?', 'Do It Again', 'Starman',
      ].map(x),
      added: [y('2021-06-12'), y('2021-07-03')],
      staleExclusive: [
        'Go Your Own Way', 'The Chain', 'Sweet Home Alabama', 'Fortunate Son', 'Have You Ever Seen the Rain', 'Born to Run',
        'More Than a Feeling', "Free Fallin'", 'Hotel California', 'The Boys Are Back in Town', 'Sultans of Swing', "Baba O'Riley",
        'Start Me Up', 'Do It Again',
      ].map(x),
      lastPlay: 0,
    },
    {
      name: 'Wedding Party Ideas', description: 'Shared with Sam. Add anything that fills a dance floor.', kind: 'owned', collaborative: true,
      tracks: [
        'September', 'Le Freak', 'We Are Family', 'Dancing Queen', 'I Will Survive', 'Celebration', 'Uptown Funk', 'Get Lucky',
        "Don't Stop 'Til You Get Enough", 'Billie Jean', "I'm Coming Out", 'Got to Be Real', 'Hot Stuff', "Stayin' Alive",
        'Call Me Maybe', 'Dancing On My Own', 'Levitating',
      ].map(x),
      added: [y('2022-02-14'), y('2022-05-28')],
      staleExclusive: ['Le Freak', 'We Are Family', 'I Will Survive', 'Celebration', "I'm Coming Out", 'Hot Stuff', "Stayin' Alive"].map(x),
      lastPlay: monthsAgo(now, 23),
    },
    {
      name: 'Britpop Summer', description: '', kind: 'owned',
      tracks: [
        'Wonderwall', "Don't Look Back in Anger", 'Live Forever', 'Common People', 'Bitter Sweet Symphony', 'Girls & Boys', 'Alright',
        'A Design for Life', 'Trash', 'I Wanna Be Adored',
      ].map(x),
      added: [monthsAgo(now, 17), monthsAgo(now, 15)],
      staleExclusive: ['Live Forever', 'A Design for Life', 'Trash', 'I Wanna Be Adored'].map(x),
      lastPlay: monthsAgo(now, 14),
    },
    { name: 'My Playlist #7', description: '', kind: 'owned', tracks: [], added: [monthsAgo(now, 30), monthsAgo(now, 30)] },
    { name: 'Jazz Vinyl Classics', description: 'Records worth owning.', kind: 'followed', owner: { id: 'mara.k', name: 'Mara K.' }, tracks: [], itemsTotal: 85 },
    { name: 'Indie Gems of the 2000s', description: '', kind: 'followed', owner: { id: 'indiegems', name: 'Indie Gems' }, tracks: [], itemsTotal: 120 },
    { name: 'Running at 170 BPM', description: 'One tempo, no breaks.', kind: 'followed', owner: { id: 'pace.club', name: 'Pace Club' }, tracks: [], itemsTotal: 64 },
    { name: 'Discover Weekly', description: 'Your weekly mixtape of fresh music.', kind: 'generated', owner: { id: 'spotify', name: 'Spotify' }, tracks: [], itemsTotal: 30 },
  ];

  const playlistId = (i: number) => `fixtureplaylist${pad(i + 1, 7)}`;
  const syncedAt = new Date(now - 2 * 3600_000).toISOString();
  const staleExclusive = new Set(plans.flatMap((p) => p.staleExclusive ?? []));
  const owned = new Set(plans.filter((p) => p.kind === 'owned').flatMap((p) => p.tracks));
  for (const id of REDISCOVER) if (owned.has(id)) throw new Error(`Rediscover track ${id} is in an Owned Playlist`);

  const insPlaylist = db.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, owner_name, kind, items_readable, items_total, snapshot_id,
       items_snapshot_id, image_url, public, collaborative, library_position, synced_at, removed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
  );
  const insItem = db.prepare('INSERT INTO playlist_items (playlist_id, position, track_id, added_at, added_by) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => {
    plans.forEach((p, i) => {
      const owner = p.owner ?? { id: DEMO_USER.id, name: DEMO_USER.displayName };
      const readable = p.kind === 'owned';
      const snap = `demo${pad(Math.floor(rng() * 1e9), 9)}`;
      insPlaylist.run(
        playlistId(i), p.name, p.description, owner.id, owner.name, p.kind, readable ? 1 : 0, p.itemsTotal ?? p.tracks.length,
        snap, readable ? snap : null, p.public ? 1 : 0, p.collaborative ? 1 : 0, i, syncedAt, null,
      );
      if (!p.added) return;
      const [from, to] = p.added;
      // Items in playlist order, added oldest first; the last one marks the latest edit.
      const dates = p.tracks.map(() => between(from, to)).sort((a, b) => a - b);
      if (dates.length) dates[dates.length - 1] = to;
      p.tracks.forEach((id, pos) => {
        const addedBy = p.collaborative && rng() < 0.4 ? 'sam.wedding' : DEMO_USER.id;
        insItem.run(playlistId(i), pos, id, isoSec(dates[pos]!), addedBy);
      });
    });
  })();

  // A playlist pruned three months ago, with its Backup, so the Backups card is not empty.
  const prunedAt = now - 92 * DAY;
  const prunedId = playlistId(plans.length);
  db.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, owner_name, kind, items_readable, items_total, snapshot_id,
       items_snapshot_id, image_url, public, collaborative, library_position, synced_at, removed_at)
     VALUES (?, 'Summer BBQ 2019', '', ?, ?, 'owned', 1, 6, 'demo000000001', 'demo000000001', NULL, 0, 0, NULL, ?, ?)`,
  ).run(prunedId, DEMO_USER.id, DEMO_USER.displayName, new Date(prunedAt).toISOString(), new Date(prunedAt).toISOString());
  const backup: PlaylistBackup = {
    version: 1,
    playlistId: prunedId,
    uri: `spotify:playlist:${prunedId}`,
    name: 'Summer BBQ 2019',
    description: '',
    kind: 'owned',
    owner: { id: DEMO_USER.id, name: DEMO_USER.displayName },
    public: false,
    collaborative: false,
    createdAt: new Date(prunedAt).toISOString(),
    tracksFrom: 'spotify',
    uris: ['Dancing Queen', 'September', 'Get Lucky', 'Call Me Maybe', 'Uptown Funk', 'Levitating'].map((t) => `spotify:track:${x(t)}`),
  };
  const saved = writeBackup(db, backup, resolve(dir, 'backups'));
  db.prepare('INSERT INTO prune_log (playlist_id, kind, pruned_at, backup_id) VALUES (?, ?, ?, ?)').run(
    prunedId, 'owned', backup.createdAt, saved.id,
  );

  // ---- Liked Songs ---------------------------------------------------------------
  const likeChance: Record<GenreId, number> = {
    indie: 0.8, house: 0.8, hiphop: 0.85, jazzfunk: 0.8, downtempo: 0.8, synthpop: 0.75,
    classicrock: 0.35, alt90s: 0.5, disco: 0.6, pop: 0.7,
  };
  const sampleLiked = new Set(
    (JSON.parse(readFileSync(new URL('../features/proposals/fixtures/library.sample.json', import.meta.url), 'utf8')) as {
      tracks: { id: string; likedAt: string | null }[];
    }).tracks.filter((t) => t.likedAt).map((t) => t.id),
  );
  const start2018 = y('2018-01-01');
  const likedAt = (t: CatalogTrack): number => {
    if (REDISCOVER.includes(t.id) || t.genre === 'synthpop') return between(start2018, y('2019-12-20'));
    if (t.genre === 'house' || t.genre === 'pop') return now - Math.pow(rng(), 2) * (now - y('2021-01-01'));
    if (t.genre === 'jazzfunk') {
      // Weekend likes: move to the next Saturday or Sunday.
      const d = new Date(between(start2018, now - 7 * DAY));
      d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7) + (rng() < 0.5 ? 1 : 0));
      return d.getTime();
    }
    return between(start2018, now - 3 * DAY);
  };
  const insLiked = db.prepare('INSERT INTO liked_tracks (track_id, added_at) VALUES (?, ?)');
  const liked = new Set<string>();
  db.transaction(() => {
    for (const t of tracks) {
      if (staleExclusive.has(t.id)) continue;
      const isFixture = t.id <= fixture(116);
      // Tracks outside every Owned Playlist are liked, so the whole catalog is in the Library.
      const like =
        REDISCOVER.includes(t.id) || !owned.has(t.id) || (isFixture ? sampleLiked.has(t.id) : rng() < likeChance[t.genre]);
      if (!like) continue;
      const at = Math.min(likedAt(t), now - 3600_000);
      insLiked.run(t.id, isoSec(at));
      liked.add(t.id);
    }
  })();

  // ---- Streaming History -------------------------------------------------------------
  const histEnd = now - 6 * DAY; // the export always lags a few days
  const histStart = monthsAgo(now, 38);
  const oldEnd = monthsAgo(now, 13);
  const meanPlays: Record<GenreId, number> = {
    indie: 32, house: 50, hiphop: 28, jazzfunk: 18, downtempo: 28, synthpop: 12, classicrock: 12, alt90s: 18, disco: 30, pop: 30,
  };
  const recentGenres = new Set<GenreId>(['house', 'disco', 'pop']);
  const platforms = ['ios', 'ios', 'osx', 'android', 'web_player'];
  const history: { ts: number; uri: string; ms: number; skipped: boolean }[] = [];
  const addPlays = (uri: string, durationMs: number, count: number, when: () => number) => {
    for (let i = 0; i < count; i++) {
      const skipped = rng() < 0.17;
      history.push({ ts: when(), uri, ms: skipped ? Math.round(between(3000, 28000)) : durationMs - Math.round(between(0, 2500)), skipped });
    }
  };
  // Exclusive Tracks of the stale playlists must look unplayed for a year, or Prune would keep them.
  const inPlaylists = new Map<string, number>();
  for (const p of plans) for (const id of p.tracks) inPlaylists.set(id, (inPlaylists.get(id) ?? 0) + 1);
  const staleOnly = new Map<string, number>();
  for (const p of plans)
    if (p.staleExclusive)
      for (const id of p.tracks) if (inPlaylists.get(id) === 1 && !liked.has(id)) staleOnly.set(id, p.lastPlay ?? oldEnd);
  for (const t of tracks) {
    const lastOld = staleOnly.get(t.id) ?? (REDISCOVER.includes(t.id) || t.genre === 'synthpop' ? oldEnd : null);
    const count = Math.round(meanPlays[t.genre] * between(0.2, 1.8) * (lastOld ? 0.6 : 1));
    if (rng() < 0.06 && !REDISCOVER.includes(t.id)) continue; // never played
    const uri = `spotify:track:${t.id}`;
    if (lastOld !== null) {
      if (lastOld > histStart) addPlays(uri, t.durationMs, Math.max(2, count), () => between(histStart, lastOld));
    }
    else if (recentGenres.has(t.genre)) addPlays(uri, t.durationMs, count, () => histEnd - Math.pow(rng(), 2.2) * (histEnd - histStart));
    else addPlays(uri, t.durationMs, count, () => between(histStart, histEnd));
  }
  // Plays of tracks that are not in the Library (from radio, other people's playlists, …).
  for (let i = 1; i <= 70; i++) {
    const uri = `spotify:track:fixturehistory${pad(i, 8)}`;
    addPlays(uri, Math.round(between(150_000, 320_000)), 1 + Math.floor(rng() * 20), () => between(histStart, histEnd));
  }
  const usedTs = new Set<number>();
  const insHist = db.prepare(
    `INSERT INTO stream_history (ts, track_uri, ms_played, reason_start, reason_end, shuffle, skipped, platform)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    for (const h of history.sort((a, b) => a.ts - b.ts)) {
      let ts = Math.round(h.ts / 1000) * 1000;
      while (usedTs.has(ts)) ts += 1000;
      usedTs.add(ts);
      insHist.run(
        isoSec(ts), h.uri, h.ms, pick(['trackdone', 'trackdone', 'clickrow', 'fwdbtn']), h.skipped ? 'fwdbtn' : 'trackdone',
        rng() < 0.4 ? 1 : 0, h.skipped ? 1 : 0, pick(platforms),
      );
    }
  })();

  // ---- Recently Played (last 50) ---------------------------------------------------
  const planIdx = (name: string) => plans.findIndex((p) => p.name === name);
  const ctx = (name: string) => ({ type: 'playlist', uri: `spotify:playlist:${playlistId(planIdx(name))}` });
  const fresh = (ids: string[]) => ids.filter((id) => !REDISCOVER.includes(id) && !staleOnly.has(id));
  const sessions: { n: number; ids: string[]; context: { type: string; uri: string } | null }[] = [
    { n: 14, ids: fresh(plans[planIdx('House Selects')]!.tracks), context: ctx('House Selects') },
    { n: 8, ids: fresh(plans[planIdx('Indie Mix')]!.tracks), context: ctx('Indie Mix') },
    { n: 6, ids: fresh(plans[planIdx('Late Night')]!.tracks), context: ctx('Late Night') },
    { n: 4, ids: [64, 65, 69, 72].map(fixture), context: { type: 'playlist', uri: `spotify:playlist:${playlistId(planIdx('Jazz Vinyl Classics'))}` } },
    { n: 8, ids: ['360', 'Von dutch', 'Espresso', 'Good Luck, Babe!', 'HOT TO GO!', 'Padam Padam', 'CUFF IT', 'Kill Bill'].map(x), context: null },
    { n: 10, ids: fresh([...liked].filter((id) => ['house', 'disco', 'pop', 'downtempo'].includes(byId.get(id)!.genre))), context: null },
  ];
  const insRecent = db.prepare('INSERT INTO recent_plays (played_at, track_id, context_type, context_uri) VALUES (?, ?, ?, ?)');
  let cursor = now - 25 * 60_000;
  db.transaction(() => {
    for (const s of sessions) {
      const pool = [...s.ids];
      for (let i = 0; i < s.n && pool.length; i++) {
        const id = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
        const t = byId.get(id)!;
        const context = s.context ?? (rng() < 0.5 ? { type: 'album', uri: `spotify:album:${albumId(t)}` } : null);
        insRecent.run(isoSec(cursor), id, context?.type ?? null, context?.uri ?? null);
        cursor -= t.durationMs + Math.round(between(0, 20_000));
      }
      cursor -= between(2, 9) * 3600_000; // a break between listening sessions
    }
  })();

  // ---- top tracks and artists, from the plays above ------------------------------------
  const playsSince = (since: number) => {
    const counts = new Map<string, number>();
    for (const h of history) if (h.ts >= since && !h.skipped && byId.has(h.uri.slice(14))) counts.set(h.uri.slice(14), (counts.get(h.uri.slice(14)) ?? 0) + 1);
    return counts;
  };
  const ranges: [string, number][] = [
    ['short_term', now - 35 * DAY],
    ['medium_term', monthsAgo(now, 6)],
    ['long_term', histStart],
  ];
  const insTopTrack = db.prepare('INSERT INTO top_tracks (time_range, rank, track_id) VALUES (?, ?, ?)');
  const insTopArtist = db.prepare('INSERT INTO top_artists (time_range, rank, artist_id) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const [range, since] of ranges) {
      const counts = playsSince(since);
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 50)
        .forEach(([id], i) => insTopTrack.run(range, i + 1, id));

      const byArtist = new Map<string, number>();
      for (const [id, n] of counts) for (const a of byId.get(id)!.artists) byArtist.set(a, (byArtist.get(a) ?? 0) + n);
      // The sample Proposals mention these as constant favourites.
      const always = ['Massive Attack', 'Bonobo', 'Boards of Canada', ...(range === 'long_term' ? ['A Tribe Called Quest', 'Nas'] : [])];
      const ranked = [...byArtist.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([a]) => a)
        .filter((a) => !always.includes(a));
      always.forEach((a, i) => ranked.splice(2 + i * 3, 0, a));
      ranked.slice(0, 30).forEach((a, i) => insTopArtist.run(range, i + 1, artistIds.get(a)!));
    }
  })();

  // ---- login, jobs, proposal state ---------------------------------------------------
  // A placeholder login so "is the user connected?" checks pass. The token is never
  // used: in demo mode every Spotify call stops before it is sent.
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, user_id, display_name, authorized_at)
     VALUES (1, 'demo', 'demo', ?, '', ?, ?, ?)`,
  ).run(now + 3650 * DAY, DEMO_USER.id, DEMO_USER.displayName, new Date(now - 40 * DAY).toISOString());

  const snapshotAt = new Date(now - 100 * 60_000);
  const snapshot = buildSnapshot(db, snapshotAt);
  const bytes = writeSnapshot(snapshot, resolve(dir, 'snapshot.json'));

  const insJob = db.prepare(
    `INSERT INTO jobs (id, kind, status, progress, total, message, error, started_at, finished_at)
     VALUES (?, ?, 'done', ?, ?, ?, NULL, ?, ?)`,
  );
  const job = (id: string, kind: string, startMs: number, minutes: number, total: number, message: string) =>
    insJob.run(id, kind, total, total, message, new Date(startMs).toISOString(), new Date(startMs + minutes * 60_000).toISOString());
  const counts = {
    playlists: plans.length,
    owned: plans.filter((p) => p.kind === 'owned').length,
    followed: plans.filter((p) => p.kind === 'followed').length,
    generated: plans.filter((p) => p.kind === 'generated').length,
  };
  const historyRows = db.prepare('SELECT COUNT(*) FROM stream_history').pluck().get() as number;
  job('demo-job-history', 'history-import', now - 5 * DAY, 0.3, historyRows, `Imported ${historyRows} plays from 4 files.`);
  job(
    'demo-job-enrich', 'enrich', now - 3 * DAY, 26, 1,
    `ReccoBeats: ${stats.recco} tracks with features, ${stats.reccoMissing} not found. ` +
      `Deezer: ${stats.deezer} tracks with BPM, ${stats.deezerMissing} not found. ` +
      'Spotify genres: empty for the first 20 artists, so the field seems stripped for this app. Stopped to save quota. ' +
      `MusicBrainz (linked): ${Math.round(stats.mb * 0.72)} artists tagged. ` +
      `Wikidata: ${stats.wd} artists with genres, ${stats.wdMissing} not found. ` +
      `MusicBrainz: ${stats.mb - Math.round(stats.mb * 0.72)} artists tagged, ${stats.mbMissing} not found.`,
  );
  job(
    'demo-job-sync', 'sync', now - 2 * 3600_000 - 90_000, 1.5, counts.playlists,
    `Synced ${counts.playlists} playlists (${counts.owned - 1} read, 1 unchanged), ${liked.size} liked songs, 50 new recent plays.`,
  );
  job('demo-job-snapshot', 'snapshot', snapshotAt.getTime() - 2000, 0.03, 1, `${snapshotSummary(snapshot, bytes)} Saved to data/snapshot.json.`);

  // ---- proposals.json -------------------------------------------------------------------
  const proposals = JSON.parse(readFileSync(fileURLToPath(SAMPLE_PROPOSALS), 'utf8')) as ProposalsFile;
  const rationale: Record<string, string> = {
    'warm-house-118-126': 'House is your most played tag in the last 6 months (Bicep, Disclosure, KAYTRANADA). Ordered by BPM so it flows without jumps.',
    'neon-drive-80s': 'Older liked songs (2018–2019) that you rarely play now. Kept as one era block.',
  };
  const file: ProposalsFile = {
    ...proposals,
    generatedAt: isoSec(now - 80 * 60_000),
    snapshotGeneratedAt: snapshot.generatedAt,
    summary:
      `About ${Math.round(snapshot.tracks.length / 10) * 10} tracks in ten clear groups: 2000s indie rock, deep house (growing fast in the last 6 months), ` +
      '90s boom bap, 70s jazz-funk with its modern heirs, trip-hop/ambient, 80s synth-pop, 70s rock, 90s alternative and Britpop, disco old and new, ' +
      'and 2010s pop. Liked Songs lean older; recent plays lean house and disco.',
    proposals: proposals.proposals.map((p) => ({ ...p, rationale: rationale[p.id] ?? p.rationale })),
  };
  writeFileSync(resolve(dir, 'proposals.json'), `${JSON.stringify(file, null, 2)}\n`);
  db.prepare("INSERT INTO proposal_state (proposal_id, status, updated_at) VALUES ('warm-house-118-126', 'approved', ?)").run(
    new Date(now - 30 * 60_000).toISOString(),
  );

  writeFileSync(
    resolve(dir, DEMO_MARKER),
    `${JSON.stringify({ version: DEMO_SEED_VERSION, seededAt: nowDate.toISOString(), note: 'Fake demo Library. Delete this folder to reseed.' }, null, 2)}\n`,
  );

  return {
    tracks: tracks.length,
    artists: artistIds.size,
    liked: liked.size,
    playlists: { owned: counts.owned, followed: counts.followed, generated: counts.generated, removed: 1 },
    recentPlays: db.prepare('SELECT COUNT(*) FROM recent_plays').pluck().get() as number,
    historyRows,
    proposals: file.proposals.length,
    snapshotTracks: snapshot.tracks.length,
  };
}
