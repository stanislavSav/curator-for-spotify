import { getDb, type DB } from '../db/db.ts';
import { assertSpotifyAllowed } from '../demo/guard.ts';
import { getAccessToken } from './auth.ts';

const API = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Spotify ${status} on ${path}: ${body.slice(0, 300)}`);
  }
}

type Query = Record<string, string | number | boolean | undefined>;

export interface Page<T> {
  items: T[];
  next: string | null;
  total: number;
  offset?: number;
  limit?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thin Spotify Web API client. All calls go through one serial queue with a
 * small gap, honour 429 Retry-After, and refresh the token on 401.
 * Uses the post-Feb-2026 paths (/items, /me/playlists, /me/library).
 */
export class SpotifyClient {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: DB = getDb(),
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly minGapMs = 120,
  ) {}

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.then(
      () => sleep(this.minGapMs),
      () => sleep(this.minGapMs),
    );
    return run;
  }

  request<T>(method: string, path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    return this.enqueue(() => this.send<T>(method, path, opts));
  }

  private async send<T>(method: string, path: string, opts: { query?: Query; body?: unknown }, attempt = 0): Promise<T> {
    assertSpotifyAllowed();
    const url = new URL(path.startsWith('http') ? path : `${API}${path}`);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const token = await getAccessToken(this.db, this.fetchImpl);
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 429 && attempt < 6) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '2');
      await sleep(Math.min(retryAfter, 120) * 1000 + 250);
      return this.send(method, path, opts, attempt + 1);
    }
    if (res.status === 401 && attempt === 0) {
      this.db.prepare('UPDATE auth SET expires_at = 0 WHERE id = 1').run();
      return this.send(method, path, opts, attempt + 1);
    }
    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
      return this.send(method, path, opts, attempt + 1);
    }
    if (!res.ok) throw new SpotifyApiError(res.status, url.pathname, await res.text());
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  get<T>(path: string, query?: Query) {
    return this.request<T>('GET', path, { query });
  }
  post<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>('POST', path, { body, query });
  }
  put<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>('PUT', path, { body, query });
  }
  delete<T>(path: string, body?: unknown, query?: Query) {
    return this.request<T>('DELETE', path, { body, query });
  }

  /** Iterates all items of an offset-paged endpoint (limit 50). */
  async *paginate<T>(path: string, query: Query = {}): AsyncGenerator<T, void, undefined> {
    let page = await this.get<Page<T>>(path, { limit: 50, ...query });
    while (true) {
      for (const item of page.items) yield item;
      if (!page.next) return;
      page = await this.get<Page<T>>(page.next);
    }
  }

  // ---- shared write helpers -------------------------------------------------

  /** Creates a private playlist for the current user and fills it in order. */
  async createPlaylist(input: { name: string; description?: string; uris: string[]; public?: boolean }) {
    const playlist = await this.post<{ id: string; external_urls: { spotify: string } }>('/me/playlists', {
      name: input.name,
      description: input.description ?? '',
      public: input.public ?? false,
    });
    await this.addItems(playlist.id, input.uris);
    return { id: playlist.id, url: playlist.external_urls.spotify };
  }

  async addItems(playlistId: string, uris: string[]) {
    for (let i = 0; i < uris.length; i += 100) {
      await this.post(`/playlists/${playlistId}/items`, { uris: uris.slice(i, i + 100) });
    }
  }

  /** Replaces all items of a playlist with these, in order (first 100 replace, the rest are added). */
  async replaceItems(playlistId: string, uris: string[]) {
    await this.put(`/playlists/${playlistId}/items`, { uris: uris.slice(0, 100) });
    await this.addItems(playlistId, uris.slice(100));
  }

  /** Changes a playlist's name and/or description. */
  async updatePlaylistDetails(playlistId: string, details: { name?: string; description?: string }) {
    await this.put(`/playlists/${playlistId}`, details);
  }

  /** Delete (owned) or unfollow (followed) playlists. Spotify has no hard delete. */
  async removeFromLibrary(uris: string[]) {
    for (let i = 0; i < uris.length; i += 40) {
      await this.delete('/me/library', undefined, { uris: uris.slice(i, i + 40).join(',') });
    }
  }

  async addToLibrary(uris: string[]) {
    for (let i = 0; i < uris.length; i += 40) {
      await this.put('/me/library', undefined, { uris: uris.slice(i, i + 40).join(',') });
    }
  }
}

let shared: SpotifyClient | null = null;
export function spotify(): SpotifyClient {
  shared ??= new SpotifyClient();
  return shared;
}
