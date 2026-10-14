import type { PlaylistKind } from '@curator/shared';

// Raw Web API shapes (only the fields we read). Spotify adds and removes
// fields often, so everything optional is typed as optional.

export interface RawArtist {
  id: string | null;
  name: string;
}

export interface RawTrack {
  type?: string;
  id: string | null;
  uri: string;
  name: string;
  duration_ms: number;
  is_local?: boolean;
  external_ids?: { isrc?: string };
  album?: { id: string | null; name: string; release_date?: string | null };
  artists?: RawArtist[];
}

export interface RawPlaylist {
  id: string;
  name: string;
  description?: string | null;
  owner: { id: string; display_name?: string | null };
  collaborative?: boolean;
  public?: boolean | null;
  snapshot_id: string;
  images?: { url: string }[] | null;
  /** Feb 2026 name. */
  items?: { total: number } | null;
  /** Deprecated alias of `items`. */
  tracks?: { total: number } | null;
}

export interface RawPlaylistEntry {
  added_at?: string | null;
  added_by?: { id?: string | null } | null;
  is_local?: boolean;
  /** Feb 2026 name. */
  item?: RawTrack | null;
  /** Deprecated alias of `item`. */
  track?: RawTrack | null;
}

export interface RawSavedTrack {
  added_at: string;
  track: RawTrack | null;
}

export interface RawPlayHistory {
  played_at: string;
  track: RawTrack | null;
  context?: { type?: string | null; uri?: string | null } | null;
}

// Rows we write.

export interface PlaylistRow {
  id: string;
  name: string;
  description: string;
  owner_id: string;
  owner_name: string;
  kind: PlaylistKind;
  items_readable: 0 | 1;
  items_total: number;
  snapshot_id: string;
  image_url: string | null;
  public: 0 | 1;
  collaborative: 0 | 1;
  library_position: number;
}

export interface TrackRow {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  isrc: string | null;
  album_id: string | null;
  album_name: string;
  release_date: string | null;
}

export interface MappedTrack {
  track: TrackRow;
  artists: { id: string; name: string }[];
}

export interface PlaylistItemRow {
  position: number;
  track_id: string;
  added_at: string | null;
  added_by: string | null;
}

/** The owner id Spotify uses for Generated Playlists (Daylist, Discover Weekly, …). */
export const SPOTIFY_OWNER_ID = 'spotify';

export function playlistKind(ownerId: string, userId: string): PlaylistKind {
  if (ownerId === SPOTIFY_OWNER_ID) return 'generated';
  return ownerId === userId ? 'owned' : 'followed';
}

export function mapPlaylist(raw: RawPlaylist, userId: string, position: number): PlaylistRow {
  const kind = playlistKind(raw.owner.id, userId);
  const collaborative = Boolean(raw.collaborative);
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description ?? '',
    owner_id: raw.owner.id,
    owner_name: raw.owner.display_name ?? raw.owner.id,
    kind,
    // Development Mode only returns items of owned or collaborative playlists.
    items_readable: kind === 'owned' || collaborative ? 1 : 0,
    items_total: raw.items?.total ?? raw.tracks?.total ?? 0,
    snapshot_id: raw.snapshot_id,
    image_url: raw.images?.[0]?.url ?? null,
    public: raw.public ? 1 : 0,
    collaborative: collaborative ? 1 : 0,
    library_position: position,
  };
}

/** Returns null for local files, episodes and other non-track items. */
export function mapTrack(raw: RawTrack | null | undefined): MappedTrack | null {
  if (!raw || !raw.id || raw.is_local) return null;
  if (raw.type && raw.type !== 'track') return null;
  return {
    track: {
      id: raw.id,
      uri: raw.uri,
      name: raw.name,
      duration_ms: raw.duration_ms,
      isrc: raw.external_ids?.isrc ?? null,
      album_id: raw.album?.id ?? null,
      album_name: raw.album?.name ?? '',
      release_date: raw.album?.release_date ?? null,
    },
    artists: (raw.artists ?? []).filter((a): a is { id: string; name: string } => Boolean(a.id)),
  };
}

/** `position` is the entry's index in the Spotify playlist, so gaps mark skipped entries. */
export function mapPlaylistEntry(
  raw: RawPlaylistEntry,
  position: number,
): { item: PlaylistItemRow; track: MappedTrack } | null {
  if (raw.is_local) return null;
  const track = mapTrack(raw.item ?? raw.track);
  if (!track) return null;
  return {
    item: {
      position,
      track_id: track.track.id,
      added_at: raw.added_at ?? null,
      added_by: raw.added_by?.id ?? null,
    },
    track,
  };
}

export interface RecentPlayRow {
  played_at: string;
  track_id: string;
  context_type: string | null;
  context_uri: string | null;
}

export function mapRecentPlay(raw: RawPlayHistory): { play: RecentPlayRow; track: MappedTrack } | null {
  const track = mapTrack(raw.track);
  if (!track) return null;
  return {
    play: {
      played_at: raw.played_at,
      track_id: track.track.id,
      context_type: raw.context?.type ?? null,
      context_uri: raw.context?.uri ?? null,
    },
    track,
  };
}

/** Fields filter for GET /playlists/{id}/items. Asks for `item` and its deprecated alias `track`. */
const TRACK_FIELDS = 'type,id,uri,name,duration_ms,is_local,external_ids(isrc),album(id,name,release_date),artists(id,name)';
export const PLAYLIST_ITEM_FIELDS = `next,total,items(added_at,added_by(id),is_local,item(${TRACK_FIELDS}),track(${TRACK_FIELDS}))`;
