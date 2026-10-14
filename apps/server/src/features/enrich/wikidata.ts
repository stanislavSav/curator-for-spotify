import { getJson, type HttpDeps, type Throttle } from './http.ts';
import { normaliseTag } from './store.ts';

// Wikidata links artists to their Spotify artist id (property P1902) and lists
// their genres (P136). One SPARQL query covers a whole batch, with exact
// matching by Spotify id, so it is fast. Coverage is best for well-known artists.

export const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
export const WIKIDATA_BATCH = 150;
const USER_AGENT = 'CuratorForSpotify/0.1 (local personal app)';
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

const SYNONYMS: Record<string, string> = {
  'electronic dance music': 'edm',
  'contemporary r&b': 'r&b',
};

/** Wikidata labels say "pop music", "house music"; tags elsewhere say "pop", "house". */
export function wikidataGenreTag(label: string): string | null {
  const t = normaliseTag(label);
  if (!t) return null;
  if (SYNONYMS[t]) return SYNONYMS[t];
  const short = t.replace(/ music$/, '');
  return short && short !== 'music' ? (normaliseTag(short) ?? short) : null;
}

export function genresQuery(spotifyIds: string[]): string {
  const values = spotifyIds.filter((id) => SPOTIFY_ID.test(id)).map((id) => `"${id}"`).join(' ');
  return `SELECT ?sid ?genreLabel WHERE { VALUES ?sid { ${values} } ?a wdt:P1902 ?sid . ?a wdt:P136 ?genre .
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". } }`;
}

/** SPARQL JSON → Spotify artist id → genre tags (deduplicated, in result order). */
export function parseGenres(body: unknown): Map<string, string[]> {
  const rows =
    (body as { results?: { bindings?: { sid?: { value?: string }; genreLabel?: { value?: string } }[] } } | null)?.results
      ?.bindings ?? [];
  const out = new Map<string, string[]>();
  for (const r of rows) {
    const id = r.sid?.value;
    const tag = r.genreLabel?.value ? wikidataGenreTag(r.genreLabel.value) : null;
    // Unlabelled genres come back as their Q-id.
    if (!id || !tag || /^q\d+$/.test(tag)) continue;
    const list = out.get(id) ?? [];
    if (!list.includes(tag)) list.push(tag);
    out.set(id, list);
  }
  return out;
}

export async function fetchWikidataGenres(http: HttpDeps, throttle: Throttle, spotifyIds: string[]) {
  await throttle.wait();
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(genresQuery(spotifyIds))}`;
  return parseGenres(await getJson(http, url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' } }));
}
