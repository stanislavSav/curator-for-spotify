import { describe, expect, it } from 'vitest';
import { parseUrlLookup } from './musicbrainz.ts';
import { parseGenres, wikidataGenreTag } from './wikidata.ts';

const ID1 = '4mYOtUmFApJtEbaeGt0RCk';
const ID2 = '1AjG4kPZtTlEhqkrLC1yno';
const rel = (id: string, name: string) => ({ 'target-type': 'artist', artist: { id, name } });

describe('parseUrlLookup', () => {
  it('reads a batch response and a single-url response', () => {
    const batch = parseUrlLookup({
      urls: [
        { resource: `https://open.spotify.com/artist/${ID1}`, relations: [rel('mb1', 'Delline Bass')] },
        { resource: `https://open.spotify.com/artist/${ID2}`, relations: [rel('mb2', 'Reflekt')] },
      ],
    });
    expect([...batch.entries()]).toEqual([
      [ID1, { mbid: 'mb1', name: 'Delline Bass' }],
      [ID2, { mbid: 'mb2', name: 'Reflekt' }],
    ]);
    expect(parseUrlLookup({ resource: `https://open.spotify.com/artist/${ID1}`, relations: [rel('mb1', 'X')] }).get(ID1)?.mbid).toBe('mb1');
  });

  it('skips links to several artists and handles empty answers', () => {
    const res = parseUrlLookup({
      urls: [{ resource: `https://open.spotify.com/artist/${ID1}`, relations: [rel('a', 'A'), rel('b', 'B')] }],
    });
    expect(res.size).toBe(0);
    expect(parseUrlLookup(null).size).toBe(0);
  });
});

describe('wikidata genres', () => {
  it('shortens "… music" labels and drops unlabelled ids', () => {
    expect(wikidataGenreTag('pop music')).toBe('pop');
    expect(wikidataGenreTag('Hip-Hop')).toBe('hip hop');
    expect(wikidataGenreTag('electronic dance music')).toBe('edm');
    expect(wikidataGenreTag('music')).toBeNull();
    const map = parseGenres({
      results: {
        bindings: [
          { sid: { value: ID1 }, genreLabel: { value: 'house music' } },
          { sid: { value: ID1 }, genreLabel: { value: 'House' } },
          { sid: { value: ID1 }, genreLabel: { value: 'Q42' } },
        ],
      },
    });
    expect(map.get(ID1)).toEqual(['house']);
  });
});
