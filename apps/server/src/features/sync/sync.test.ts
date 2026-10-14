import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DB } from '../../db/db.ts';
import { libraryTrackIds } from '../../db/library.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import { entry, localEntry, play, playlist, track, USER_ID } from './fixtures.ts';
import type { RawPlayHistory, RawPlaylist, RawPlaylistEntry, RawTrack } from './mapping.ts';
import { syncSummary } from './summary.ts';
import { runSync } from './sync.ts';

const PAGE = 2; // small pages so paging is exercised

interface FakeSpotify {
  playlists: RawPlaylist[];
  items: Record<string, RawPlaylistEntry[] | 403>;
  liked: { added_at: string; track: RawTrack }[];
  topTracks: RawTrack[];
  topArtists: { id: string; name: string }[];
  recent: RawPlayHistory[];
  calls: string[];
}

function fakeFetch(s: FakeSpotify): typeof fetch {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const paged = (url: URL, all: unknown[]) => {
    const offset = Number(url.searchParams.get('offset') ?? 0);
    const next = new URL(url);
    next.searchParams.set('offset', String(offset + PAGE));
    return json({ items: all.slice(offset, offset + PAGE), next: offset + PAGE < all.length ? next.toString() : null, total: all.length });
  };
  return (async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const path = url.pathname.replace('/v1', '');
    s.calls.push(path);
    if (path === '/me') return json({ id: USER_ID });
    if (path === '/me/playlists') return paged(url, s.playlists);
    const m = path.match(/^\/playlists\/([^/]+)\/items$/);
    if (m) {
      const items = s.items[m[1]!];
      if (items === 403 || !items) return json({ error: { status: 403, message: 'Forbidden' } }, 403);
      expect(url.searchParams.get('fields')).toContain('item(');
      return paged(url, items);
    }
    if (path === '/me/tracks') return paged(url, s.liked);
    if (path === '/me/top/tracks') return json({ items: s.topTracks, next: null, total: s.topTracks.length });
    if (path === '/me/top/artists') return json({ items: s.topArtists, next: null, total: s.topArtists.length });
    if (path === '/me/player/recently-played') return json({ items: s.recent, next: null });
    return json({ error: 'unexpected ' + path }, 404);
  }) as typeof fetch;
}

function connect(db: DB) {
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, authorized_at)
     VALUES (1, 'token', 'refresh', ?, '', '2026-10-01T00:00:00Z')`,
  ).run(Date.now() + 3_600_000);
}

let db: DB;
let s: FakeSpotify;
const sync = () => runSync(db, new SpotifyClient(db, fakeFetch(s), 0));

beforeEach(() => {
  db = openDb(':memory:');
  connect(db);
  s = {
    playlists: [
      playlist('own', USER_ID),
      playlist('fol', 'someone'),
      playlist('gen', 'spotify'),
      playlist('collab', 'someone', { collaborative: true }),
    ],
    items: {
      own: [entry(track('t1', ['a1', 'a2'])), localEntry, entry(track('t2')), entry(null)],
      collab: 403,
    },
    liked: [
      { added_at: '2025-01-01T00:00:00Z', track: track('t2') },
      { added_at: '2025-02-01T00:00:00Z', track: track('t3', ['a3']) },
    ],
    topTracks: [track('t3', ['a3']), track('t4')],
    topArtists: [{ id: 'a3', name: 'Artist a3' }, { id: 'a9', name: 'Top only' }],
    recent: [play('t5', '2026-10-12T10:00:00Z', 'spotify:playlist:own'), play('t2', '2026-10-12T09:00:00Z')],
    calls: [],
  };
});

describe('runSync', () => {
  it('stores playlists, items, liked, top and recent plays', async () => {
    const result = await sync();

    expect(result).toMatchObject({ playlists: 4, removed: 0, itemsUpdated: 1, unreadable: 1, liked: 2, newRecentPlays: 2 });

    const kinds = db.prepare('SELECT id, kind, items_readable, library_position FROM playlists ORDER BY library_position').all();
    expect(kinds).toEqual([
      { id: 'own', kind: 'owned', items_readable: 1, library_position: 0 },
      { id: 'fol', kind: 'followed', items_readable: 0, library_position: 1 },
      { id: 'gen', kind: 'generated', items_readable: 0, library_position: 2 },
      { id: 'collab', kind: 'followed', items_readable: 0, library_position: 3 },
    ]);

    // local file and null item skipped; positions keep the Spotify index
    expect(db.prepare("SELECT position, track_id FROM playlist_items WHERE playlist_id = 'own' ORDER BY position").all()).toEqual([
      { position: 0, track_id: 't1' },
      { position: 2, track_id: 't2' },
    ]);
    expect(db.prepare("SELECT items_snapshot_id FROM playlists WHERE id = 'own'").get()).toEqual({ items_snapshot_id: 'own-s1' });

    expect(db.prepare('SELECT artist_id FROM track_artists WHERE track_id = ? ORDER BY position').all('t1')).toEqual([
      { artist_id: 'a1' },
      { artist_id: 'a2' },
    ]);
    expect(db.prepare("SELECT isrc, album_name FROM tracks WHERE id = 't3'").get()).toEqual({ isrc: 'ISRCt3', album_name: 'Album t3' });
    expect(db.prepare("SELECT rank, track_id FROM top_tracks WHERE time_range = 'short_term' ORDER BY rank").all()).toEqual([
      { rank: 1, track_id: 't3' },
      { rank: 2, track_id: 't4' },
    ]);
    expect(db.prepare("SELECT name FROM artists WHERE id = 'a9'").get()).toEqual({ name: 'Top only' });
    expect(db.prepare("SELECT context_uri FROM recent_plays WHERE track_id = 't5'").get()).toEqual({
      context_uri: 'spotify:playlist:own',
    });
    expect(libraryTrackIds(db).sort()).toEqual(['t1', 't2', 't3', 't4', 't5']);
  });

  it('skips unchanged playlists and does not retry a 403 until the snapshot changes', async () => {
    await sync();
    s.calls = [];
    await sync();
    expect(s.calls.filter((c) => c.endsWith('/items'))).toEqual([]);

    s.playlists[0] = playlist('own', USER_ID, { snapshot_id: 'own-s2' });
    s.items.own = [entry(track('t9'))];
    s.playlists[3] = playlist('collab', 'someone', { collaborative: true, snapshot_id: 'collab-s2' });
    s.items.collab = [entry(track('t8'))];
    s.calls = [];
    const r = await sync();
    expect(s.calls.filter((c) => c.endsWith('/items'))).toEqual(['/playlists/own/items', '/playlists/collab/items']);
    expect(r.itemsUpdated).toBe(2);
    expect(db.prepare("SELECT track_id FROM playlist_items WHERE playlist_id = 'own'").all()).toEqual([{ track_id: 't9' }]);
    expect(db.prepare("SELECT items_readable FROM playlists WHERE id = 'collab'").get()).toEqual({ items_readable: 1 });
  });

  it('marks unlisted playlists removed and clears it when they return', async () => {
    await sync();
    const own = s.playlists.shift()!;
    const r = await sync();
    expect(r.removed).toBe(1);
    expect(db.prepare("SELECT removed_at IS NOT NULL AS removed FROM playlists WHERE id = 'own'").get()).toEqual({ removed: 1 });
    expect(libraryTrackIds(db)).not.toContain('t1');

    s.playlists.push(own);
    await sync();
    expect(db.prepare("SELECT removed_at, library_position FROM playlists WHERE id = 'own'").get()).toEqual({
      removed_at: null,
      library_position: 3,
    });
  });

  it('replaces liked songs and accumulates recent plays', async () => {
    await sync();
    s.liked = [{ added_at: '2025-03-01T00:00:00Z', track: track('t6') }];
    s.recent = [play('t7', '2026-10-13T10:00:00Z'), ...s.recent];
    const r = await sync();
    expect(r.newRecentPlays).toBe(1);
    expect(db.prepare('SELECT track_id FROM liked_tracks').all()).toEqual([{ track_id: 't6' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM recent_plays').get()).toEqual({ n: 3 });
  });

  it('keeps genres filled by enrich', async () => {
    await sync();
    db.prepare(`UPDATE artists SET genres_json = '["house"]' WHERE id = 'a1'`).run();
    await sync();
    expect(db.prepare("SELECT genres_json FROM artists WHERE id = 'a1'").get()).toEqual({ genres_json: '["house"]' });
  });

  it('reports progress up to the total', async () => {
    const events: [number, number][] = [];
    await runSync(db, new SpotifyClient(db, fakeFetch(s), 0), (d, t) => events.push([d, t]));
    const last = events.at(-1)!;
    expect(last[0]).toBe(last[1]);
    expect(last[1]).toBe(10 + 2);
  });
});

describe('syncSummary', () => {
  it('counts the local Library', async () => {
    await sync();
    const sum = syncSummary(db);
    expect(sum.playlists).toEqual({ owned: 1, followed: 2, generated: 1, removed: 0, readable: 1, itemsSynced: 1 });
    expect(sum).toMatchObject({ likedTracks: 2, libraryTracks: 5, recentPlays: 2, lastSync: null, lastSuccessAt: null });
    expect(sum.artists).toBe(4);
  });
});
