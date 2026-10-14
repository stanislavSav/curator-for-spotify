import { getJson, type HttpDeps, type Throttle } from './http.ts';
import { normaliseName, normaliseTag, round2 } from './store.ts';

export const MB_URL = 'https://musicbrainz.org/ws/2';
export const MB_USER_AGENT = 'SpotifyCurator/0.1 (local personal app)';
export const MB_MAX_TAGS = 10;

export interface MbArtist {
  mbid: string;
  name: string;
  tags: { name: string; count: number }[];
}

interface RawTag {
  name?: string;
  count?: number;
}
interface RawArtist {
  id?: string;
  name?: string;
  score?: number;
  tags?: RawTag[];
  genres?: RawTag[];
}

function toArtist(a: RawArtist | undefined): MbArtist | null {
  if (!a?.id || !a.name) return null;
  const tags = [...(a.tags ?? []), ...(a.genres ?? [])]
    .filter((t): t is { name: string; count: number } => typeof t.name === 'string')
    .map((t) => ({ name: t.name, count: typeof t.count === 'number' ? t.count : 0 }));
  return { mbid: a.id, name: a.name, tags };
}

/** `/isrc/{isrc}?inc=artist-credits+tags` → the credited artists (with their tags) per recording. */
export function parseIsrcLookup(body: unknown): MbArtist[][] {
  const recordings = (body as { recordings?: { 'artist-credit'?: { artist?: RawArtist }[] }[] } | null)?.recordings ?? [];
  return recordings.map((r) => (r['artist-credit'] ?? []).map((c) => toArtist(c.artist)).filter((a) => a !== null));
}

/** `/artist?query=...` search results with their score (0–100). */
export function parseArtistSearch(body: unknown): (MbArtist & { score: number })[] {
  const artists = (body as { artists?: RawArtist[] } | null)?.artists ?? [];
  return artists
    .map((a) => {
      const artist = toArtist(a);
      return artist ? { ...artist, score: typeof a.score === 'number' ? a.score : 0 } : null;
    })
    .filter((a) => a !== null);
}

/**
 * Finds the credit for `artistName` in an ISRC lookup. A track with one
 * Spotify artist and one credited artist matches even when the names are
 * written differently (transliteration); otherwise the names must match.
 */
export function matchCredit(recordings: MbArtist[][], artistName: string, spotifyArtistCount: number): MbArtist | null {
  const want = normaliseName(artistName);
  for (const credits of recordings) {
    const hit = credits.find((c) => normaliseName(c.name) === want);
    if (hit) return hit;
  }
  if (spotifyArtistCount === 1) {
    const solo = recordings.find((credits) => credits.length === 1);
    if (solo) return solo[0]!;
  }
  return null;
}

export interface MbLink {
  mbid: string;
  name: string;
}

const SPOTIFY_ARTIST_URL = /open\.spotify\.com\/artist\/([A-Za-z0-9]{22})/;

/**
 * `/url?resource=…&inc=artist-rels` → Spotify artist id → the MusicBrainz artist
 * linked to that Spotify page. One resource returns a bare url object, several
 * return `{ urls: [...] }`. Links to more than one artist are ambiguous and skipped.
 */
export function parseUrlLookup(body: unknown): Map<string, MbLink> {
  type RawUrl = { resource?: string; relations?: { 'target-type'?: string; artist?: RawArtist }[] };
  const b = body as ({ urls?: RawUrl[] } & RawUrl) | null;
  const urls = b?.urls ?? (b?.resource ? [b] : []);
  const out = new Map<string, MbLink>();
  for (const u of urls) {
    const spotifyId = u.resource?.match(SPOTIFY_ARTIST_URL)?.[1];
    if (!spotifyId) continue;
    const artists = new Map<string, string>();
    for (const r of u.relations ?? []) {
      if (r['target-type'] === 'artist' && r.artist?.id && r.artist.name) artists.set(r.artist.id, r.artist.name);
    }
    if (artists.size !== 1) continue;
    const [mbid, name] = [...artists.entries()][0]!;
    out.set(spotifyId, { mbid, name });
  }
  return out;
}

/** Search fallback: accept only a single exact-name hit with a high score. */
export function pickSearchHit(hits: (MbArtist & { score: number })[], artistName: string): MbArtist | null {
  const want = normaliseName(artistName);
  const exact = hits.filter((h) => h.score >= 90 && normaliseName(h.name) === want);
  if (exact.length === 1) return exact[0]!;
  // Several artists share the name: trust the top one only if it is clearly ahead and tagged.
  if (exact.length > 1 && exact[0]!.score === 100 && exact[1]!.score < 90 && exact[0]!.tags.length > 0) return exact[0]!;
  return null;
}

/** Tag counts → normalised tags with weight count / max count (0–1), top 10. */
export function tagsFromCounts(tags: { name: string; count: number }[]): { tag: string; weight: number }[] {
  const merged = new Map<string, number>();
  for (const t of tags) {
    const tag = normaliseTag(t.name);
    if (!tag || t.count <= 0) continue;
    merged.set(tag, Math.max(merged.get(tag) ?? 0, t.count));
  }
  const max = Math.max(0, ...merged.values());
  if (max === 0) return [];
  return [...merged.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MB_MAX_TAGS)
    .map(([tag, count]) => ({ tag, weight: round2(count / max) }));
}

export class MusicBrainz {
  constructor(
    private readonly deps: HttpDeps,
    private readonly throttle: Throttle,
  ) {}

  private async get(path: string) {
    await this.throttle.wait();
    return getJson(this.deps, `${MB_URL}${path}`, { headers: { 'User-Agent': MB_USER_AGENT } });
  }

  async byIsrc(isrc: string): Promise<MbArtist[][]> {
    return parseIsrcLookup(await this.get(`/isrc/${encodeURIComponent(isrc)}?fmt=json&inc=artist-credits+tags`));
  }

  /** Up to 100 Spotify artist ids → their MusicBrainz artists, in one request. */
  async linkSpotifyArtists(spotifyIds: string[]): Promise<Map<string, MbLink>> {
    if (spotifyIds.length === 0) return new Map();
    const resources = spotifyIds
      .map((id) => `resource=${encodeURIComponent(`https://open.spotify.com/artist/${id}`)}`)
      .join('&');
    return parseUrlLookup(await this.get(`/url?${resources}&inc=artist-rels&fmt=json`));
  }

  /** Up to 100 MusicBrainz artist ids → artists with their tags, in one search request. */
  async artistsByMbid(mbids: string[]): Promise<Map<string, MbArtist>> {
    if (mbids.length === 0) return new Map();
    const query = `arid:(${mbids.join(' OR ')})`;
    const hits = parseArtistSearch(await this.get(`/artist/?fmt=json&limit=100&query=${encodeURIComponent(query)}`));
    return new Map(hits.map((h) => [h.mbid, h]));
  }

  async searchArtist(name: string) {
    const query = `artist:"${name.replace(/(["\\])/g, '\\$1')}"`;
    return parseArtistSearch(await this.get(`/artist/?fmt=json&limit=5&query=${encodeURIComponent(query)}`));
  }
}
