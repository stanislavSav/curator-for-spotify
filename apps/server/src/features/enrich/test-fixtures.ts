// Test helpers for the enrich feature: seed an in-memory DB and fake fetch.
import { openDb, type DB } from '../../db/db.ts';

export interface SeedTrack {
  id: string;
  name?: string;
  isrc?: string | null;
  artists: { id: string; name: string }[];
  liked?: string;
  release?: string;
  durationMs?: number;
}

/** 22-char Spotify-like id from a short label. */
export const sid = (label: string) => label.padEnd(22, 'Z').slice(0, 22);

export function seedDb(tracks: SeedTrack[], opts: { connected?: boolean } = {}): DB {
  const db = openDb(':memory:');
  const insTrack = db.prepare(
    'INSERT INTO tracks (id, uri, name, duration_ms, isrc, album_name, release_date) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const insArtist = db.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)');
  const insCredit = db.prepare('INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, ?)');
  const insLiked = db.prepare('INSERT INTO liked_tracks (track_id, added_at) VALUES (?, ?)');
  for (const t of tracks) {
    insTrack.run(t.id, `spotify:track:${t.id}`, t.name ?? t.id, t.durationMs ?? 200_000, t.isrc ?? null, 'Album', t.release ?? null);
    t.artists.forEach((a, i) => {
      insArtist.run(a.id, a.name);
      insCredit.run(t.id, a.id, i);
    });
    insLiked.run(t.id, t.liked ?? '2026-01-01T00:00:00Z');
  }
  if (opts.connected) {
    db.prepare(
      `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, user_id, display_name, authorized_at)
       VALUES (1, 'token', 'refresh', ?, '', 'user1', 'Test User', '2026-10-01T00:00:00Z')`,
    ).run(Date.now() + 3_600_000);
  }
  return db;
}

type Handler = (url: URL) => unknown | Response | undefined;

/** Fake fetch that routes by URL prefix and records every call. */
export function fakeFetch(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url.href);
    for (const [prefix, handler] of Object.entries(routes)) {
      if (!url.href.startsWith(prefix)) continue;
      const out = handler(url);
      if (out instanceof Response) return out;
      if (out === undefined) return new Response('not found', { status: 404 });
      return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url.href}`);
  }) as typeof fetch;
  return { fetch: impl, calls };
}

export const noSleep = async () => {};
