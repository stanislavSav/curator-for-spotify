// Small fetch helpers for the third-party enrichment sources (ReccoBeats,
// Deezer, MusicBrainz). Spotify calls go through SpotifyClient instead.

export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`HTTP ${status} on ${new URL(url).host}: ${body.slice(0, 200)}`);
  }
}

export interface HttpDeps {
  fetch: typeof fetch;
  sleep: Sleep;
}

/**
 * GET a JSON document. Retries 429/503 (Retry-After or exponential backoff)
 * and network errors. Returns null on 404; throws HttpError on other failures.
 */
export async function getJson<T>(
  deps: HttpDeps,
  url: string,
  opts: { headers?: Record<string, string>; retries?: number } = {},
): Promise<T | null> {
  const retries = opts.retries ?? 4;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await deps.fetch(url, { headers: { Accept: 'application/json', ...opts.headers } });
    } catch (err) {
      if (attempt >= retries) throw err;
      await deps.sleep(1000 * 2 ** attempt);
      continue;
    }
    if ((res.status === 429 || res.status === 503 || res.status === 502) && attempt < retries) {
      const retryAfter = Number(res.headers.get('Retry-After'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 120) * 1000 : 1000 * 2 ** (attempt + 1);
      await deps.sleep(waitMs);
      continue;
    }
    if (res.status === 404) return null;
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text);
    return (text ? JSON.parse(text) : null) as T | null;
  }
}

/** Keeps at least `gapMs` between the starts of consecutive calls. */
export class Throttle {
  private last = 0;
  constructor(
    private readonly gapMs: number,
    private readonly sleep: Sleep,
    private readonly clock: () => number = Date.now,
  ) {}

  async wait() {
    const due = this.last + this.gapMs - this.clock();
    if (due > 0) await this.sleep(due);
    this.last = this.clock();
  }
}
