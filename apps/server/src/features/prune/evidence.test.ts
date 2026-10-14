import { describe, expect, it } from 'vitest';
import type { HistorySummary } from '@curator/shared';
import { cutoffDate, scorePlaylists, type EvidenceInput, type EvidencePlaylist } from './evidence.ts';

const NOW = new Date('2026-10-13T12:00:00Z');
const HISTORY: HistorySummary = {
  rows: 1000,
  firstTs: '2018-01-01T00:00:00Z',
  lastTs: '2026-10-10T00:00:00Z',
  distinctTracks: 100,
  matchedTracks: 80,
  matchedPct: 80,
};
const NO_HISTORY: HistorySummary = { rows: 0, firstTs: null, lastTs: null, distinctTracks: 0, matchedTracks: 0, matchedPct: 0 };

const pl = (id: string, over: Partial<EvidencePlaylist> = {}): EvidencePlaylist => ({
  id,
  name: id,
  kind: 'owned',
  ownerId: 'me',
  ownerName: 'Me',
  itemsReadable: true,
  itemsTotal: 3,
  collaborative: false,
  imageUrl: null,
  ...over,
});

function input(over: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    playlists: [],
    items: [],
    likedTrackIds: new Set(),
    contextPlays: [],
    trackPlays: new Map(),
    history: HISTORY,
    recentPlaysSince: '2026-10-01T00:00:00Z',
    userId: 'me',
    ...over,
  };
}

const item = (playlistId: string, trackId: string, addedAt: string | null = null, addedBy: string | null = 'me') => ({
  playlistId,
  trackId,
  addedAt,
  addedBy,
});

const score = (i: EvidenceInput, months = 12) => scorePlaylists(i, { months, now: NOW });
const byId = (i: EvidenceInput, id: string, months = 12) => score(i, months).playlists.find((p) => p.id === id)!;

describe('cutoffDate', () => {
  it('goes back whole calendar months', () => {
    expect(cutoffDate(NOW, 12).toISOString()).toBe('2025-10-13T12:00:00.000Z');
    expect(cutoffDate(NOW, 3).toISOString()).toBe('2026-07-13T12:00:00.000Z');
  });
});

describe('scorePlaylists', () => {
  it('never lists Generated Playlists', () => {
    const r = score(input({ playlists: [pl('dw', { kind: 'generated', itemsReadable: false })] }));
    expect(r.playlists).toHaveLength(0);
    expect(r.excludedGenerated).toBe(1);
  });

  it('finds Exclusive Tracks: in one playlist only and not liked', () => {
    const i = input({
      playlists: [pl('a'), pl('b')],
      items: [item('a', 't1'), item('a', 't2'), item('a', 't3'), item('b', 't2'), item('b', 't4')],
      likedTrackIds: new Set(['t3']),
    });
    expect(byId(i, 'a').evidence.exclusive?.tracks).toBe(1); // t1 only: t2 shared, t3 liked
    expect(byId(i, 'b').evidence.exclusive?.tracks).toBe(1); // t4
  });

  it('a track in a generated or removed playlist still makes it non-exclusive only when that playlist is active', () => {
    const i = input({
      playlists: [pl('a'), pl('gen', { kind: 'generated' })],
      items: [item('a', 't1'), item('gen', 't1'), item('gone', 't1')],
    });
    // 'gone' is not in the playlists list (removed), 'gen' is active but generated.
    expect(byId(i, 'a').evidence.exclusive?.tracks).toBe(0);
  });

  it('keeps a playlist with a recent Exclusive Track play', () => {
    const i = input({
      playlists: [pl('a')],
      items: [item('a', 't1', '2020-01-01T00:00:00Z')],
      trackPlays: new Map([['t1', { lastPlayed: '2026-09-01T10:00:00Z', playsInWindow: 7 }]]),
    });
    const p = byId(i, 'a');
    expect(p.group).toBe('keep');
    expect(p.lastUsed).toBe('2026-09-01T10:00:00Z');
    expect(p.lastUsedSource).toBe('exclusive');
    expect(p.evidence.exclusive).toEqual({ tracks: 1, lastPlayed: '2026-09-01T10:00:00Z', playsInWindow: 7 });
    expect(p.preselect).toBe(false);
  });

  it('makes an owned playlist with only old evidence a pre-ticked candidate', () => {
    const i = input({
      playlists: [pl('a')],
      items: [item('a', 't1', '2021-05-01T00:00:00Z'), item('a', 't2', '2022-02-01T00:00:00Z')],
      trackPlays: new Map([['t1', { lastPlayed: '2023-03-03T00:00:00Z', playsInWindow: 0 }]]),
    });
    const p = byId(i, 'a');
    expect(p.group).toBe('candidate');
    expect(p.preselect).toBe(true);
    expect(p.lastUsed).toBe('2023-03-03T00:00:00Z');
    expect(p.lastUsedSource).toBe('exclusive');
    expect(p.evidence.edit).toEqual({ lastAdded: '2022-02-01T00:00:00Z' });
    expect(p.reasons.join(' ')).toMatch(/older than 12 months/);
  });

  it('uses the newest of context, exclusive and edit evidence', () => {
    const i = input({
      playlists: [pl('a')],
      items: [item('a', 't1', '2026-08-01T00:00:00Z')],
      trackPlays: new Map([['t1', { lastPlayed: '2024-01-01T00:00:00Z', playsInWindow: 0 }]]),
      contextPlays: [
        { playlistId: 'a', playedAt: '2025-01-01T00:00:00Z' },
        { playlistId: 'a', playedAt: '2025-02-01T00:00:00Z' },
      ],
    });
    const p = byId(i, 'a');
    expect(p.lastUsed).toBe('2026-08-01T00:00:00Z');
    expect(p.lastUsedSource).toBe('edit');
    expect(p.evidence.context).toEqual({ lastPlayed: '2025-02-01T00:00:00Z', plays: 2 });
    expect(p.group).toBe('keep');
  });

  it('respects the months threshold', () => {
    const i = input({ playlists: [pl('a')], items: [item('a', 't1', '2026-01-01T00:00:00Z')] });
    expect(byId(i, 'a', 12).group).toBe('keep');
    expect(byId(i, 'a', 6).group).toBe('candidate');
  });

  it('puts a Followed Playlist without context evidence in no-evidence, never pre-ticked', () => {
    const i = input({ playlists: [pl('f', { kind: 'followed', itemsReadable: false, ownerId: 'other', itemsTotal: 80 })] });
    const p = byId(i, 'f');
    expect(p.group).toBe('no-evidence');
    expect(p.preselect).toBe(false);
    expect(p.evidence.exclusive).toBeNull();
    expect(p.notes.join(' ')).toMatch(/can’t be read/);
    expect(p.notes.join(' ')).toMatch(/Recently Played only goes back to 2026-10-01/);
  });

  it('keeps a Followed Playlist that was played from recently', () => {
    const i = input({
      playlists: [pl('f', { kind: 'followed', itemsReadable: false, itemsTotal: 80 })],
      contextPlays: [{ playlistId: 'f', playedAt: '2026-10-12T08:00:00Z' }],
    });
    expect(byId(i, 'f').group).toBe('keep');
    expect(byId(i, 'f').lastUsedSource).toBe('context');
  });

  it('puts an owned playlist with no data in no-evidence', () => {
    const i = input({ playlists: [pl('a')], items: [item('a', 't1', null)] });
    const p = byId(i, 'a');
    expect(p.group).toBe('no-evidence');
    expect(p.lastUsed).toBeNull();
    expect(p.preselect).toBe(false);
  });

  it('makes empty playlists candidates, owned or followed', () => {
    const i = input({
      playlists: [pl('e', { itemsTotal: 0 }), pl('fe', { kind: 'followed', itemsReadable: false, itemsTotal: 0 })],
    });
    for (const id of ['e', 'fe']) {
      const p = byId(i, id);
      expect(p.group).toBe('candidate');
      expect(p.preselect).toBe(true);
      expect(p.reasons[0]).toMatch(/Empty playlist/);
    }
  });

  it('notes when there are no Exclusive Tracks', () => {
    const i = input({
      playlists: [pl('a'), pl('b')],
      items: [item('a', 't1', '2020-01-01T00:00:00Z'), item('b', 't1', '2020-01-01T00:00:00Z')],
    });
    expect(byId(i, 'a').notes).toContain('No Exclusive Tracks — plays can’t be attributed.');
  });

  it('notes few Exclusive Tracks as weak evidence', () => {
    const i = input({ playlists: [pl('a')], items: [item('a', 't1', '2020-01-01T00:00:00Z')] });
    expect(byId(i, 'a').notes.join(' ')).toMatch(/Only 1 Exclusive Track — weak/);
  });

  it('without Streaming History: candidates are listed but not pre-ticked', () => {
    const i = input({ history: NO_HISTORY, playlists: [pl('a')], items: [item('a', 't1', '2020-01-01T00:00:00Z')] });
    const p = byId(i, 'a');
    expect(p.group).toBe('candidate');
    expect(p.preselect).toBe(false);
    expect(p.notes.join(' ')).toMatch(/Streaming History not imported/);
  });

  it('notes a history that ends well before now', () => {
    const i = input({
      history: { ...HISTORY, lastTs: '2026-03-01T00:00:00Z' },
      playlists: [pl('a')],
      items: [item('a', 't1', '2020-01-01T00:00:00Z')],
    });
    expect(byId(i, 'a').notes).toContain('History ends 2026-03-01; newer plays unknown.');
  });

  it('only counts own additions as edits on playlists the user does not own', () => {
    const i = input({
      playlists: [pl('c', { kind: 'followed', collaborative: true, ownerId: 'friend' })],
      items: [item('c', 't1', '2026-09-01T00:00:00Z', 'friend'), item('c', 't2', '2025-01-01T00:00:00Z', 'me')],
    });
    const p = byId(i, 'c');
    expect(p.evidence.edit).toEqual({ lastAdded: '2025-01-01T00:00:00Z' });
    expect(p.group).toBe('candidate');
    expect(p.preselect).toBe(false);
    expect(p.notes).toContain('Collaborative — others may still use it.');
  });

  it('notes playlists whose tracks are not synced yet', () => {
    const i = input({ playlists: [pl('a', { itemsTotal: 20 })] });
    const p = byId(i, 'a');
    expect(p.group).toBe('no-evidence');
    expect(p.notes.join(' ')).toMatch(/not synced/);
  });

  it('sorts oldest lastUsed first, no evidence first of all', () => {
    const i = input({
      playlists: [pl('new'), pl('old'), pl('none')],
      items: [item('new', 'a', '2026-01-01T00:00:00Z'), item('old', 'b', '2019-01-01T00:00:00Z'), item('none', 'c')],
    });
    expect(score(i).playlists.map((p) => p.id)).toEqual(['none', 'old', 'new']);
  });
});
