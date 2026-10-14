// Test fixtures shaped like post-Feb-2026 Web API responses.
import type { RawPlayHistory, RawPlaylist, RawPlaylistEntry, RawTrack } from './mapping.ts';

export const USER_ID = 'listener1';

export const track = (id: string, artistIds: string[] = ['a1'], extra: Partial<RawTrack> = {}): RawTrack => ({
  type: 'track',
  id,
  uri: `spotify:track:${id}`,
  name: `Track ${id}`,
  duration_ms: 200_000,
  is_local: false,
  external_ids: { isrc: `ISRC${id}` },
  album: { id: `al-${id}`, name: `Album ${id}`, release_date: '2020-05-01' },
  artists: artistIds.map((a) => ({ id: a, name: `Artist ${a}` })),
  ...extra,
});

export const playlist = (id: string, ownerId: string, extra: Partial<RawPlaylist> = {}): RawPlaylist => ({
  id,
  name: `Playlist ${id}`,
  description: '',
  owner: { id: ownerId, display_name: ownerId === USER_ID ? 'Test Listener' : ownerId },
  collaborative: false,
  public: false,
  snapshot_id: `${id}-s1`,
  images: [{ url: `https://img/${id}` }],
  items: { href: `https://api.spotify.com/v1/playlists/${id}/items`, total: 2 } as { total: number },
  ...extra,
});

export const entry = (t: RawTrack | null, extra: Partial<RawPlaylistEntry> = {}): RawPlaylistEntry => ({
  added_at: '2024-01-02T03:04:05Z',
  added_by: { id: USER_ID },
  is_local: false,
  item: t,
  ...extra,
});

export const localEntry: RawPlaylistEntry = {
  added_at: '2024-01-02T03:04:05Z',
  added_by: { id: USER_ID },
  is_local: true,
  item: { type: 'track', id: null, uri: 'spotify:local:a:b:c:180', name: 'Local', duration_ms: 180_000, is_local: true },
};

export const episodeEntry: RawPlaylistEntry = entry({
  type: 'episode',
  id: 'ep1',
  uri: 'spotify:episode:ep1',
  name: 'An episode',
  duration_ms: 3_000_000,
});

export const play = (trackId: string, playedAt: string, contextUri: string | null = null): RawPlayHistory => ({
  played_at: playedAt,
  track: track(trackId),
  context: contextUri ? { type: 'playlist', uri: contextUri } : null,
});

/** Wraps items in an offset page. */
export const page = <T>(items: T[], next: string | null = null) => ({ items, next, total: items.length, offset: 0, limit: 50 });
