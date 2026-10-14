import { getJson, type HttpDeps } from './http.ts';

export const DEEZER_URL = 'https://api.deezer.com/track/isrc:';

interface DeezerTrack {
  bpm?: number;
  error?: { type?: string; message?: string; code?: number };
}

export type DeezerResult = { kind: 'bpm'; bpm: number } | { kind: 'no-bpm' } | { kind: 'not-found' } | { kind: 'quota' };

/** Deezer answers HTTP 200 with an `error` object: code 800 = unknown ISRC, 4 = quota. */
export function parseDeezer(body: unknown): DeezerResult {
  const t = body as DeezerTrack | null;
  if (!t) return { kind: 'not-found' };
  if (t.error) return t.error.code === 4 ? { kind: 'quota' } : { kind: 'not-found' };
  return typeof t.bpm === 'number' && t.bpm > 0 ? { kind: 'bpm', bpm: t.bpm } : { kind: 'no-bpm' };
}

export async function fetchDeezerBpm(deps: HttpDeps, isrc: string): Promise<DeezerResult> {
  for (let attempt = 0; ; attempt++) {
    const result = parseDeezer(await getJson(deps, `${DEEZER_URL}${encodeURIComponent(isrc)}`));
    if (result.kind !== 'quota' || attempt >= 3) return result;
    await deps.sleep(5000 * (attempt + 1));
  }
}
