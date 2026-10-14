import { describe, expect, it } from 'vitest';
import { episodeEntry, entry, localEntry, play, playlist, track, USER_ID } from './fixtures.ts';
import { mapPlaylist, mapPlaylistEntry, mapRecentPlay, mapTrack, playlistKind } from './mapping.ts';

describe('playlistKind', () => {
  it('classifies by owner', () => {
    expect(playlistKind('spotify', USER_ID)).toBe('generated');
    expect(playlistKind(USER_ID, USER_ID)).toBe('owned');
    expect(playlistKind('someone', USER_ID)).toBe('followed');
  });
});

describe('mapPlaylist', () => {
  it('maps an owned playlist as readable', () => {
    const row = mapPlaylist(playlist('p1', USER_ID), USER_ID, 3);
    expect(row).toMatchObject({
      id: 'p1',
      kind: 'owned',
      items_readable: 1,
      items_total: 2,
      owner_name: 'Test Listener',
      image_url: 'https://img/p1',
      library_position: 3,
      collaborative: 0,
    });
  });

  it('makes followed playlists unreadable unless collaborative', () => {
    expect(mapPlaylist(playlist('p2', 'other'), USER_ID, 0).items_readable).toBe(0);
    expect(mapPlaylist(playlist('p3', 'other', { collaborative: true }), USER_ID, 0)).toMatchObject({
      kind: 'followed',
      items_readable: 1,
      collaborative: 1,
    });
    expect(mapPlaylist(playlist('p4', 'spotify'), USER_ID, 0)).toMatchObject({ kind: 'generated', items_readable: 0 });
  });

  it('accepts the deprecated tracks total and missing optional fields', () => {
    const raw = playlist('p5', USER_ID, { items: undefined, tracks: { total: 7 }, images: null, description: null });
    expect(mapPlaylist(raw, USER_ID, 0)).toMatchObject({ items_total: 7, image_url: null, description: '' });
  });
});

describe('mapTrack', () => {
  it('maps the fields we store', () => {
    expect(mapTrack(track('t1', ['a1', 'a2']))).toEqual({
      track: {
        id: 't1',
        uri: 'spotify:track:t1',
        name: 'Track t1',
        duration_ms: 200_000,
        isrc: 'ISRCt1',
        album_id: 'al-t1',
        album_name: 'Album t1',
        release_date: '2020-05-01',
      },
      artists: [
        { id: 'a1', name: 'Artist a1' },
        { id: 'a2', name: 'Artist a2' },
      ],
    });
  });

  it('skips null, local and non-track items', () => {
    expect(mapTrack(null)).toBeNull();
    expect(mapTrack(track('t1', ['a1'], { is_local: true }))).toBeNull();
    expect(mapTrack(track('t1', ['a1'], { type: 'episode' }))).toBeNull();
  });

  it('tolerates missing isrc, album and artist ids', () => {
    const t = mapTrack(track('t1', ['a1'], { external_ids: {}, album: undefined, artists: [{ id: null, name: 'x' }] }));
    expect(t?.track).toMatchObject({ isrc: null, album_id: null, album_name: '', release_date: null });
    expect(t?.artists).toEqual([]);
  });
});

describe('mapPlaylistEntry', () => {
  it('reads item, or the deprecated track alias', () => {
    expect(mapPlaylistEntry(entry(track('t1')), 4)?.item).toEqual({
      position: 4,
      track_id: 't1',
      added_at: '2024-01-02T03:04:05Z',
      added_by: USER_ID,
    });
    const legacy = mapPlaylistEntry({ added_at: null, added_by: null, track: track('t2') }, 0);
    expect(legacy?.item).toEqual({ position: 0, track_id: 't2', added_at: null, added_by: null });
  });

  it('skips local files, episodes and null items', () => {
    expect(mapPlaylistEntry(localEntry, 0)).toBeNull();
    expect(mapPlaylistEntry(episodeEntry, 0)).toBeNull();
    expect(mapPlaylistEntry(entry(null), 0)).toBeNull();
  });
});

describe('mapRecentPlay', () => {
  it('keeps the context uri', () => {
    expect(mapRecentPlay(play('t1', '2026-10-01T10:00:00Z', 'spotify:playlist:p1'))?.play).toEqual({
      played_at: '2026-10-01T10:00:00Z',
      track_id: 't1',
      context_type: 'playlist',
      context_uri: 'spotify:playlist:p1',
    });
    expect(mapRecentPlay(play('t1', '2026-10-01T10:00:00Z'))?.play.context_uri).toBeNull();
  });
});
