import type { AudioFeatures } from '@curator/shared';
import { getJson, type HttpDeps } from './http.ts';

export const RECCOBEATS_URL = 'https://api.reccobeats.com/v1/audio-features';
export const RECCOBEATS_BATCH = 40;

interface ReccoItem {
  id: string; // ReccoBeats UUID, not the Spotify id
  href?: string; // https://open.spotify.com/track/{spotifyId}
  isrc?: string;
  tempo?: number | null;
  key?: number | null;
  mode?: number | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
  loudness?: number | null;
  acousticness?: number | null;
  instrumentalness?: number | null;
}

type Features = Omit<AudioFeatures, 'trackId' | 'source'>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toFeatures(item: ReccoItem): Features {
  const key = num(item.key);
  const mode = num(item.mode);
  return {
    tempo: num(item.tempo),
    key: key != null && key >= 0 && key <= 11 ? key : null,
    mode: mode === 0 || mode === 1 ? mode : null,
    energy: num(item.energy),
    danceability: num(item.danceability),
    valence: num(item.valence),
    loudness: num(item.loudness),
    acousticness: num(item.acousticness),
    instrumentalness: num(item.instrumentalness),
  };
}

export function spotifyIdFromHref(href: string | undefined): string | null {
  const m = href?.match(/open\.spotify\.com\/track\/([A-Za-z0-9]{22})/);
  return m ? m[1]! : null;
}

/**
 * Maps a ReccoBeats response back to the requested Spotify ids. The response
 * uses its own UUIDs, drops unknown ids and does not keep order, so we match on
 * the Spotify id inside `href`, then fall back to the ISRC.
 */
export function parseReccoBeats(
  body: unknown,
  requested: { id: string; isrc: string | null }[],
): Map<string, Features> {
  const items = ((body as { content?: ReccoItem[] } | null)?.content ?? []).filter((x) => x && typeof x === 'object');
  const wanted = new Set(requested.map((r) => r.id));
  const byIsrc = new Map<string, string[]>();
  for (const r of requested) if (r.isrc) byIsrc.set(r.isrc.toUpperCase(), [...(byIsrc.get(r.isrc.toUpperCase()) ?? []), r.id]);

  const out = new Map<string, Features>();
  const unmatched: ReccoItem[] = [];
  for (const item of items) {
    const sid = spotifyIdFromHref(item.href);
    if (sid && wanted.has(sid)) out.set(sid, toFeatures(item));
    else unmatched.push(item);
  }
  for (const item of unmatched) {
    for (const id of byIsrc.get(item.isrc?.toUpperCase() ?? '') ?? []) if (!out.has(id)) out.set(id, toFeatures(item));
  }
  return out;
}

export async function fetchReccoBeats(deps: HttpDeps, tracks: { id: string; isrc: string | null }[]) {
  const url = `${RECCOBEATS_URL}?ids=${tracks.map((t) => t.id).join(',')}`;
  return parseReccoBeats(await getJson(deps, url), tracks);
}
