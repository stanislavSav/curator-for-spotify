import { describe, expect, it } from 'vitest';
import { parseDeezer } from './deezer.ts';
import { matchCredit, parseArtistSearch, parseIsrcLookup, pickSearchHit, tagsFromCounts } from './musicbrainz.ts';
import { parseReccoBeats, spotifyIdFromHref } from './reccobeats.ts';
import { normaliseName, normaliseTag } from './store.ts';

describe('ReccoBeats', () => {
  // Real response shape (research 04): own UUIDs, Spotify id only in href, order not kept.
  const body = {
    content: [
      {
        id: '636463ea-c943-44d5-b600-1fa6f3ad8057',
        href: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
        isrc: 'GBFFP0300052',
        energy: 0.918,
        key: 1,
        mode: 1,
        tempo: 148.114,
        valence: 0.24,
      },
      {
        id: '25c8ca63-5895-4572-84eb-a7040bc08c4d',
        href: 'https://open.spotify.com/track/RELINKEDxxxxxxxxxxxxxx',
        isrc: 'USUG11904206',
        energy: 0.73,
        key: 12,
        mode: 3,
        tempo: 171.001,
      },
    ],
  };

  it('maps items back by the Spotify id in href, then by ISRC', () => {
    const out = parseReccoBeats(body, [
      { id: '0VjIjW4GlUZAMYd2vXMi3b', isrc: 'usug11904206' },
      { id: '3n3Ppam7vgaVa1iaRUc9Lp', isrc: 'GBFFP0300052' },
      { id: 'missingmissingmissing0', isrc: null },
    ]);
    expect([...out.keys()].sort()).toEqual(['0VjIjW4GlUZAMYd2vXMi3b', '3n3Ppam7vgaVa1iaRUc9Lp']);
    expect(out.get('3n3Ppam7vgaVa1iaRUc9Lp')).toMatchObject({ tempo: 148.114, key: 1, mode: 1, energy: 0.918, danceability: null });
    // Out-of-range key/mode become null.
    expect(out.get('0VjIjW4GlUZAMYd2vXMi3b')).toMatchObject({ tempo: 171.001, key: null, mode: null });
  });

  it('handles empty or odd bodies', () => {
    expect(parseReccoBeats(null, [{ id: 'a', isrc: null }]).size).toBe(0);
    expect(parseReccoBeats({ content: [] }, []).size).toBe(0);
    expect(spotifyIdFromHref('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b?si=1')).toBe('0VjIjW4GlUZAMYd2vXMi3b');
    expect(spotifyIdFromHref(undefined)).toBeNull();
  });
});

describe('Deezer', () => {
  it('reads bpm and the 200-with-error responses', () => {
    expect(parseDeezer({ id: 1, bpm: 170.84 })).toEqual({ kind: 'bpm', bpm: 170.84 });
    expect(parseDeezer({ id: 1, bpm: 0 })).toEqual({ kind: 'no-bpm' });
    expect(parseDeezer({ error: { type: 'DataException', message: 'no data', code: 800 } })).toEqual({ kind: 'not-found' });
    expect(parseDeezer({ error: { type: 'Exception', message: 'Quota limit exceeded', code: 4 } })).toEqual({ kind: 'quota' });
    expect(parseDeezer(null)).toEqual({ kind: 'not-found' });
  });
});

describe('MusicBrainz', () => {
  // Trimmed real response of /isrc/USUG11904206?inc=artist-credits+tags.
  const isrcBody = {
    isrc: 'USUG11904206',
    recordings: [
      {
        title: 'Blinding Lights',
        'artist-credit': [
          {
            name: 'The Weeknd',
            artist: {
              id: 'c8b03190-306c-4120-bb0b-6f2ebfc06ea9',
              name: 'The Weeknd',
              tags: [
                { count: 3, name: '2010s' },
                { count: 7, name: 'alternative r&b' },
                { name: 'r&b', count: 14 },
                { count: 0, name: 'rnb' },
                { count: 6, name: 'Synth Pop' },
                { count: 1, name: 'seen live' },
              ],
            },
          },
        ],
        tags: [{ name: 'synth-pop', count: 3 }],
      },
    ],
  };

  it('parses credited artists with tags', () => {
    const recs = parseIsrcLookup(isrcBody);
    expect(recs).toHaveLength(1);
    expect(recs[0]![0]).toMatchObject({ mbid: 'c8b03190-306c-4120-bb0b-6f2ebfc06ea9', name: 'The Weeknd' });
    expect(parseIsrcLookup({})).toEqual([]);
  });

  it('normalises tag counts to 0–1 weights and drops noise', () => {
    const tags = tagsFromCounts(parseIsrcLookup(isrcBody)[0]![0]!.tags);
    expect(tags).toEqual([
      { tag: 'r&b', weight: 1 },
      { tag: 'alternative r&b', weight: 0.5 },
      { tag: 'synth-pop', weight: 0.43 },
      { tag: '2010s', weight: 0.21 },
    ]);
    expect(tagsFromCounts([{ name: 'x', count: 0 }])).toEqual([]);
  });

  it('matches credits by name, or a lone credit for a solo track', () => {
    const recs = [[{ mbid: '1', name: 'Beyoncé', tags: [] }], [{ mbid: '2', name: 'Other', tags: [] }]];
    expect(matchCredit(recs, 'Beyonce', 2)?.mbid).toBe('1');
    expect(matchCredit([[{ mbid: '3', name: 'Кино', tags: [] }]], 'Kino', 1)?.mbid).toBe('3');
    expect(matchCredit([[{ mbid: '3', name: 'Кино', tags: [] }]], 'Kino', 2)).toBeNull();
  });

  it('accepts a search hit only when the name is exact and unambiguous', () => {
    const hits = parseArtistSearch({
      artists: [
        { id: 'a', name: 'Nirvana', score: 100, tags: [{ name: 'grunge', count: 20 }] },
        { id: 'b', name: 'Nirvana', score: 100 },
      ],
    });
    expect(pickSearchHit(hits, 'Nirvana')).toBeNull();
    expect(pickSearchHit(hits.slice(0, 1), 'nirvana')?.mbid).toBe('a');
    expect(pickSearchHit([{ mbid: 'c', name: 'Nirvana Tribute', score: 95, tags: [] }], 'Nirvana')).toBeNull();
  });
});

describe('normalisation', () => {
  it('normalises tags', () => {
    expect(normaliseTag('  Hip-Hop ')).toBe('hip hop');
    expect(normaliseTag('RnB')).toBe('r&b');
    expect(normaliseTag('seen live')).toBeNull();
    expect(normaliseTag('1999')).toBeNull();
    expect(normaliseTag('80s')).toBe('80s');
  });

  it('normalises names', () => {
    expect(normaliseName('The Beatles')).toBe(normaliseName('beatles'));
    expect(normaliseName('Simon & Garfunkel')).toBe(normaliseName('Simon and Garfunkel'));
    expect(normaliseName('Sigur Rós')).toBe('sigurros');
  });
});
