import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistBackup } from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import { getCandidates } from './candidates.ts';
import { backupFileName, listBackups, restoreBackup, restoreDescription, runPrune, slugify } from './prune.ts';

interface Call {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
}

/** Fake Spotify: routes by "METHOD /path"; a handler returns [status, body]. */
function fakeSpotify(routes: Record<string, (c: Call) => [number, unknown?]>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? 'GET',
      path: url.pathname.replace(/^\/v1/, ''),
      query: Object.fromEntries(url.searchParams),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const handler = routes[`${call.method} ${call.path}`];
    const [status, body] = handler ? handler(call) : [404, { error: 'no route' }];
    return new Response(body === undefined ? null : JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function seed(db: DB) {
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, user_id, display_name, authorized_at)
     VALUES (1, 'tok', 'ref', ?, '', 'me', 'Me', '2026-10-01T00:00:00Z')`,
  ).run(Date.now() + 3_600_000);
  const playlist = db.prepare(
    `INSERT INTO playlists (id, name, description, owner_id, owner_name, kind, items_readable, items_total, snapshot_id, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 's', '2026-10-01T00:00:00Z')`,
  );
  playlist.run('own1', 'Old Summer Mix!', 'Sunny', 'me', 'Me', 'owned', 1, 2);
  playlist.run('own2', 'Broken', '', 'me', 'Me', 'owned', 1, 1);
  playlist.run('fol1', 'Jazz Classics', 'Editorial', 'other', 'Someone', 'followed', 0, 50);
  playlist.run('gen1', 'Discover Weekly', '', 'spotify', 'Spotify', 'generated', 0, 30);
  for (const id of ['t1', 't2', 't3'])
    db.prepare('INSERT INTO tracks (id, uri, name, duration_ms) VALUES (?, ?, ?, 1000)').run(id, `spotify:track:${id}`, id);
  const item = db.prepare('INSERT INTO playlist_items (playlist_id, position, track_id, added_at) VALUES (?, ?, ?, ?)');
  item.run('own1', 0, 't1', '2020-01-01T00:00:00Z');
  item.run('own1', 1, 't2', '2020-01-02T00:00:00Z');
  item.run('own2', 0, 't3', '2020-01-01T00:00:00Z');
}

let db: DB;
let dir: string;
beforeEach(() => {
  db = openDb(':memory:');
  seed(db);
  dir = mkdtempSync(join(tmpdir(), 'curator-backups-'));
});

const itemsPage = (uris: string[]) => [200, { items: uris.map((uri) => ({ added_at: null, item: { uri } })), next: null, total: uris.length }] as [number, unknown];

describe('slugify / backupFileName', () => {
  it('makes a safe, short file name', () => {
    expect(slugify('Old Summer Mix! ☀️ Été')).toBe('old-summer-mix-ete');
    expect(slugify('★★★')).toBe('playlist');
    expect(backupFileName('2026-10-13T10:00:00Z', 'abc', 'My List')).toBe('2026-10-13-abc-my-list.json');
  });
});

describe('restoreDescription', () => {
  it('appends a note and stays within 300 characters', () => {
    expect(restoreDescription('', '2026-10-13T10:00:00Z')).toBe('Restored from a Backup of 2026-10-13.');
    expect(restoreDescription('Sunny', '2026-10-13T10:00:00Z')).toBe('Sunny Restored from a Backup of 2026-10-13.');
    expect(restoreDescription('x'.repeat(400), '2026-10-13T10:00:00Z').length).toBeLessThanOrEqual(300);
  });
});

describe('runPrune', () => {
  it('backs up, removes and logs each playlist; one failure does not stop the rest', async () => {
    const { calls, fetchImpl } = fakeSpotify({
      'GET /playlists/own1/items': () => itemsPage(['spotify:track:t2', 'spotify:track:t1', 'spotify:local:a:b:c:1']),
      'GET /playlists/own2/items': () => [403, { error: 'forbidden' }],
      'DELETE /me/library': (c) => (c.query.uris === 'spotify:playlist:own2' ? [400, { error: 'boom' }] : [200]),
    });
    const client = new SpotifyClient(db, fetchImpl, 0);
    const progress: number[] = [];
    const results = await runPrune(db, client, ['own1', 'own2', 'fol1', 'gen1', 'missing'], {
      backupDir: dir,
      onProgress: (d) => progress.push(d),
    });

    expect(results.map((r) => [r.playlistId, r.status, r.action, r.tracksFrom])).toEqual([
      ['own1', 'done', 'deleted', 'spotify'],
      ['own2', 'failed', null, 'database'],
      ['fol1', 'done', 'unfollowed', 'none'],
      ['gen1', 'failed', null, null],
      ['missing', 'failed', null, null],
    ]);
    expect(results[3]!.error).toMatch(/Generated/);
    expect(progress).toEqual([0, 1, 2, 3, 4, 5]);

    // Fresh items from Spotify, in Spotify's order.
    const backup = JSON.parse(readFileSync(join(dir, readdirSync(dir).find((f) => f.includes('own1'))!), 'utf8')) as PlaylistBackup;
    expect(backup).toMatchObject({
      playlistId: 'own1',
      uri: 'spotify:playlist:own1',
      name: 'Old Summer Mix!',
      description: 'Sunny',
      kind: 'owned',
      owner: { id: 'me', name: 'Me' },
      uris: ['spotify:track:t2', 'spotify:track:t1', 'spotify:local:a:b:c:1'],
    });
    // A Backup exists even when the remove failed, and the playlist stays.
    expect(readdirSync(dir)).toHaveLength(3);
    const removed = db.prepare('SELECT id FROM playlists WHERE removed_at IS NOT NULL ORDER BY id').all();
    expect(removed).toEqual([{ id: 'fol1' }, { id: 'own1' }]);
    expect(db.prepare('SELECT playlist_id, kind FROM prune_log ORDER BY playlist_id').all()).toEqual([
      { playlist_id: 'fol1', kind: 'followed' },
      { playlist_id: 'own1', kind: 'owned' },
    ]);
    // Followed Playlists are not read from Spotify (Dev Mode returns 403).
    expect(calls.some((c) => c.path === '/playlists/fol1/items')).toBe(false);
  });

  it('refuses a playlist that is already removed', async () => {
    db.prepare("UPDATE playlists SET removed_at = '2026-01-01' WHERE id = 'own1'").run();
    const { fetchImpl } = fakeSpotify({});
    const [r] = await runPrune(db, new SpotifyClient(db, fetchImpl, 0), ['own1'], { backupDir: dir });
    expect(r).toMatchObject({ status: 'failed', error: 'Already removed from the Library.' });
  });

  it('drops pruned playlists from the candidates', async () => {
    const { fetchImpl } = fakeSpotify({ 'GET /playlists/own1/items': () => itemsPage([]), 'DELETE /me/library': () => [200] });
    expect(getCandidates(db, 12).playlists.map((p) => p.id).sort()).toEqual(['fol1', 'own1', 'own2']);
    await runPrune(db, new SpotifyClient(db, fetchImpl, 0), ['own1'], { backupDir: dir });
    expect(getCandidates(db, 12).playlists.map((p) => p.id).sort()).toEqual(['fol1', 'own2']);
  });
});

describe('restoreBackup', () => {
  async function prune(ids: string[]) {
    const { fetchImpl } = fakeSpotify({
      'GET /playlists/own1/items': () => itemsPage(['spotify:track:t1', 'spotify:local:x:y:z:1', 'spotify:track:t2']),
      'DELETE /me/library': () => [200],
    });
    await runPrune(db, new SpotifyClient(db, fetchImpl, 0), ids, { backupDir: dir });
  }

  it('recreates an Owned Playlist from the Backup URIs', async () => {
    await prune(['own1']);
    const [b] = listBackups(db, dir);
    expect(b).toMatchObject({ playlistId: 'own1', kind: 'owned', trackCount: 3, restored: null });

    const { calls, fetchImpl } = fakeSpotify({
      'POST /me/playlists': () => [201, { id: 'new1', external_urls: { spotify: 'https://open.spotify.com/playlist/new1' } }],
      'POST /playlists/new1/items': () => [201, { snapshot_id: 'x' }],
    });
    const r = await restoreBackup(db, new SpotifyClient(db, fetchImpl, 0), b!.id);
    expect(r).toMatchObject({ action: 'recreated', playlistId: 'new1', added: 2, skipped: 1 });
    expect(calls[0]!.body).toMatchObject({ name: 'Old Summer Mix!', public: false });
    expect((calls[0]!.body as { description: string }).description).toMatch(/^Sunny Restored from a Backup of \d{4}-/);
    expect(calls[1]!.body).toEqual({ uris: ['spotify:track:t1', 'spotify:track:t2'] });
    expect(listBackups(db, dir)[0]!.restored).toMatchObject({ playlistId: 'new1' });

    await expect(restoreBackup(db, new SpotifyClient(db, fetchImpl, 0), b!.id)).rejects.toThrow(/already restored/);
  });

  it('follows a Followed Playlist again and clears removed_at', async () => {
    await prune(['fol1']);
    const [b] = listBackups(db, dir);
    const { calls, fetchImpl } = fakeSpotify({ 'PUT /me/library': () => [200] });
    const r = await restoreBackup(db, new SpotifyClient(db, fetchImpl, 0), b!.id);
    expect(r).toMatchObject({ action: 'refollowed', playlistId: 'fol1' });
    expect(calls[0]!.query.uris).toBe('spotify:playlist:fol1');
    expect(db.prepare("SELECT removed_at FROM playlists WHERE id = 'fol1'").get()).toEqual({ removed_at: null });
  });

  it('404s on an unknown Backup', async () => {
    const { fetchImpl } = fakeSpotify({});
    await expect(restoreBackup(db, new SpotifyClient(db, fetchImpl, 0), 99)).rejects.toMatchObject({ status: 404 });
  });
});

describe('getCandidates (DB loader)', () => {
  it('reads context, Exclusive Track and edit evidence from the tables', () => {
    db.prepare("INSERT INTO recent_plays VALUES ('2026-10-12T08:00:00Z', 't9', 'playlist', 'spotify:playlist:fol1')").run();
    db.prepare("INSERT INTO recent_plays VALUES ('2026-10-12T09:00:00Z', 't9', 'album', 'spotify:album:x')").run();
    const hist = db.prepare('INSERT INTO stream_history (ts, track_uri, ms_played) VALUES (?, ?, ?)');
    hist.run('2026-09-01T00:00:00Z', 'spotify:track:t3', 120000); // own2 exclusive, recent
    hist.run('2026-09-02T00:00:00Z', 'spotify:track:t1', 5000); // too short
    hist.run('2022-01-01T00:00:00Z', 'spotify:track:t1', 120000);
    db.prepare("INSERT INTO liked_tracks VALUES ('t2', '2020-01-01T00:00:00Z')").run();

    const r = getCandidates(db, 12, new Date('2026-10-13T00:00:00Z'));
    const p = (id: string) => r.playlists.find((x) => x.id === id)!;
    expect(r.excludedGenerated).toBe(1);
    expect(r.recentPlaysSince).toBe('2026-10-12T08:00:00Z');
    expect(p('fol1')).toMatchObject({ group: 'keep', evidence: { context: { plays: 1 } } });
    expect(p('own2')).toMatchObject({ group: 'keep', lastUsedSource: 'exclusive' });
    expect(p('own1')).toMatchObject({
      group: 'candidate',
      preselect: true,
      lastUsed: '2022-01-01T00:00:00Z',
      evidence: { exclusive: { tracks: 1, playsInWindow: 0 }, edit: { lastAdded: '2020-01-02T00:00:00Z' } },
    });
  });
});
