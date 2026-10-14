import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../config.ts';
import { openDb } from '../db/db.ts';
import { NotConnectedError } from '../spotify/auth.ts';
import { SpotifyClient } from '../spotify/client.ts';
import { DEMO_MESSAGE, DemoModeError, isBlockedInDemo, withDemoMode } from './guard.ts';

const ok = () => new Response('app');
const call = (handler: (req: Request) => Response | Promise<Response>, method: string, path: string) =>
  handler(new Request(`http://127.0.0.1${path}`, { method }));

describe('isBlockedInDemo', () => {
  it('blocks Sync, Enrich, Spotify writes and logout', () => {
    for (const path of ['/api/sync', '/api/enrich', '/api/prune', '/api/prune/restore/3', '/api/proposals/apply', '/api/dj/sets', '/api/dj/sets/abc/create', '/auth/logout'])
      expect(isBlockedInDemo('POST', path), path).toBe(true);
  });

  it('lets local work through', () => {
    expect(isBlockedInDemo('GET', '/api/sync/summary')).toBe(false);
    expect(isBlockedInDemo('POST', '/api/enrich/snapshot')).toBe(false);
    expect(isBlockedInDemo('POST', '/api/prune/history/import')).toBe(false);
    expect(isBlockedInDemo('PATCH', '/api/proposals/x')).toBe(false);
    expect(isBlockedInDemo('POST', '/api/dj/preview')).toBe(false);
    expect(isBlockedInDemo('GET', '/api/dj/sets')).toBe(false);
    expect(isBlockedInDemo('POST', '/api/dj/drafts')).toBe(false);
  });
});

describe('withDemoMode', () => {
  it('answers /api/demo in both modes', async () => {
    expect(await (await call(withDemoMode(ok, true), 'GET', '/api/demo')).json()).toEqual({ demo: true });
    expect(await (await call(withDemoMode(ok, false), 'GET', '/api/demo')).json()).toEqual({ demo: false });
  });

  it('refuses blocked requests with the demo message, only in demo mode', async () => {
    const res = await call(withDemoMode(ok, true), 'POST', '/api/sync');
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: DEMO_MESSAGE, code: 'demo' });
    expect(await (await call(withDemoMode(ok, false), 'POST', '/api/sync')).text()).toBe('app');
    expect(await (await call(withDemoMode(ok, true), 'GET', '/api/sync/summary')).text()).toBe('app');
  });
});

describe('SpotifyClient in demo mode', () => {
  afterEach(() => {
    config.demo = false;
  });

  it('throws before anything is sent', async () => {
    config.demo = true;
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response('{}');
    }) as typeof fetch;
    const client = new SpotifyClient(openDb(':memory:'), fakeFetch, 0);
    const err = await client.createPlaylist({ name: 'x', uris: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DemoModeError);
    expect(err).toBeInstanceOf(NotConnectedError);
    expect((err as Error).message).toBe(DEMO_MESSAGE);
    expect(calls).toBe(0);
  });
});
