import type {
  EvidenceSource,
  HistorySummary,
  PruneCandidate,
  PruneCandidatesResponse,
  PruneGroup,
  UsageEvidence,
} from '@curator/shared';

export interface EvidencePlaylist {
  id: string;
  name: string;
  kind: 'owned' | 'followed' | 'generated';
  ownerId: string;
  ownerName: string;
  itemsReadable: boolean;
  itemsTotal: number;
  collaborative: boolean;
  imageUrl: string | null;
}

export interface EvidenceItem {
  playlistId: string;
  trackId: string;
  addedAt: string | null;
  addedBy: string | null;
}

/** Everything the scoring needs. Built from the DB by loadEvidenceInput, or by hand in tests. */
export interface EvidenceInput {
  /** Playlists that are not removed. */
  playlists: EvidencePlaylist[];
  items: EvidenceItem[];
  likedTrackIds: Set<string>;
  /** Recently Played rows with a playlist context. */
  contextPlays: { playlistId: string; playedAt: string }[];
  /** Streaming History per track id, plays ≥30 s only, counted against the same cutoff. */
  trackPlays: Map<string, { lastPlayed: string; playsInWindow: number }>;
  history: HistorySummary;
  recentPlaysSince: string | null;
  userId: string | null;
}

export interface ScoreOptions {
  months: number;
  now: Date;
}

export function cutoffDate(now: Date, months: number): Date {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

const day = (iso: string) => iso.slice(0, 10);
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);
const SOURCE_LABEL: Record<EvidenceSource, string> = {
  context: 'played from the playlist',
  exclusive: 'Exclusive Track played',
  edit: 'tracks added',
};
const STALE_HISTORY_DAYS = 14;

/** Scores every playlist for Usage Evidence and sorts it into candidate / no-evidence / keep. */
export function scorePlaylists(input: EvidenceInput, opts: ScoreOptions): PruneCandidatesResponse {
  const cutoff = cutoffDate(opts.now, opts.months);
  const cutoffMs = cutoff.getTime();
  const historyImported = input.history.rows > 0;
  const historyStale =
    historyImported &&
    input.history.lastTs !== null &&
    opts.now.getTime() - Date.parse(input.history.lastTs) > STALE_HISTORY_DAYS * 86_400_000;

  const active = input.playlists.filter((p) => p.kind !== 'generated');
  const activeIds = new Set(input.playlists.map((p) => p.id));

  const itemsByPlaylist = new Map<string, EvidenceItem[]>();
  const playlistsByTrack = new Map<string, Set<string>>();
  for (const it of input.items) {
    if (!activeIds.has(it.playlistId)) continue;
    let list = itemsByPlaylist.get(it.playlistId);
    if (!list) itemsByPlaylist.set(it.playlistId, (list = []));
    list.push(it);
    let set = playlistsByTrack.get(it.trackId);
    if (!set) playlistsByTrack.set(it.trackId, (set = new Set()));
    set.add(it.playlistId);
  }

  const contextByPlaylist = new Map<string, { lastPlayed: string; plays: number }>();
  for (const c of input.contextPlays) {
    const prev = contextByPlaylist.get(c.playlistId);
    contextByPlaylist.set(c.playlistId, {
      lastPlayed: later(prev?.lastPlayed ?? null, c.playedAt)!,
      plays: (prev?.plays ?? 0) + 1,
    });
  }

  const playlists: PruneCandidate[] = active.map((p) => {
    const kind = p.kind as 'owned' | 'followed';
    const items = itemsByPlaylist.get(p.id) ?? [];
    const hasItems = items.length > 0;
    const isEmpty = p.itemsTotal === 0 && !hasItems;

    const evidence: UsageEvidence = { context: contextByPlaylist.get(p.id) ?? null, exclusive: null, edit: null };

    if (p.itemsReadable && hasItems) {
      const exclusiveIds = new Set(
        items
          .map((i) => i.trackId)
          .filter((t) => playlistsByTrack.get(t)?.size === 1 && !input.likedTrackIds.has(t)),
      );
      let lastPlayed: string | null = null;
      let playsInWindow = 0;
      for (const t of exclusiveIds) {
        const s = input.trackPlays.get(t);
        if (!s) continue;
        lastPlayed = later(lastPlayed, s.lastPlayed);
        playsInWindow += s.playsInWindow;
      }
      evidence.exclusive = { tracks: exclusiveIds.size, lastPlayed, playsInWindow };

      // For a playlist the user doesn't own, only their own additions say they use it.
      let lastAdded: string | null = null;
      for (const i of items) {
        if (!i.addedAt) continue;
        if (kind !== 'owned' && (!input.userId || i.addedBy !== input.userId)) continue;
        lastAdded = later(lastAdded, i.addedAt);
      }
      evidence.edit = lastAdded ? { lastAdded } : null;
    }

    const dated: [EvidenceSource, string | null][] = [
      ['context', evidence.context?.lastPlayed ?? null],
      ['exclusive', evidence.exclusive?.lastPlayed ?? null],
      ['edit', evidence.edit?.lastAdded ?? null],
    ];
    let lastUsed: string | null = null;
    let lastUsedSource: EvidenceSource | null = null;
    for (const [source, date] of dated) {
      if (date && (!lastUsed || Date.parse(date) > Date.parse(lastUsed))) {
        lastUsed = date;
        lastUsedSource = source;
      }
    }
    const recent = lastUsed !== null && Date.parse(lastUsed) >= cutoffMs;

    const reasons: string[] = [];
    let group: PruneGroup;
    if (isEmpty) {
      group = 'candidate';
      reasons.push('Empty playlist (0 tracks).');
    } else if (recent) {
      group = 'keep';
      reasons.push(`Used ${day(lastUsed!)} (${SOURCE_LABEL[lastUsedSource!]}).`);
    } else if (lastUsed) {
      group = 'candidate';
      reasons.push(`Last Usage Evidence ${day(lastUsed)} (${SOURCE_LABEL[lastUsedSource!]}), older than ${opts.months} months.`);
    } else {
      group = 'no-evidence';
      reasons.push(
        kind === 'followed'
          ? 'Followed Playlist: no plays from it in Recently Played, and its tracks can’t be read.'
          : 'No Usage Evidence at all: no plays, no Exclusive Track plays, no dated edits.',
      );
    }
    if (group === 'candidate' && !isEmpty && kind === 'owned' && evidence.exclusive && evidence.exclusive.playsInWindow === 0 && historyImported) {
      reasons.push(`No Exclusive Track plays in the last ${opts.months} months.`);
    }

    const notes: string[] = [];
    const readable = p.itemsReadable && hasItems;
    if (!isEmpty) {
      if (p.itemsReadable && !hasItems && p.itemsTotal > 0) notes.push('Tracks not synced yet — run Sync.');
      if (!p.itemsReadable) notes.push('Tracks can’t be read (Followed Playlist), so plays can’t be matched to it.');
      if (readable && !historyImported) notes.push('Streaming History not imported — only edits and the last 50 plays count.');
      if (readable && historyImported && evidence.exclusive?.tracks === 0)
        notes.push('No Exclusive Tracks — plays can’t be attributed.');
      if (readable && historyImported && evidence.exclusive && evidence.exclusive.tracks > 0 && evidence.exclusive.tracks < 3)
        notes.push(`Only ${evidence.exclusive.tracks} Exclusive Track${evidence.exclusive.tracks === 1 ? '' : 's'} — weak evidence.`);
      if (historyStale && group !== 'keep' && readable)
        notes.push(`History ends ${day(input.history.lastTs!)}; newer plays unknown.`);
      if (!readable && input.recentPlaysSince && group !== 'keep')
        notes.push(`Recently Played only goes back to ${day(input.recentPlaysSince)}.`);
    }
    if (p.collaborative) notes.push('Collaborative — others may still use it.');

    // Pre-tick only when the evidence can carry it: with no Streaming History, an old edit date says little.
    const preselect = group === 'candidate' && (isEmpty || (kind === 'owned' && historyImported));
    if (group === 'candidate' && !preselect) notes.push('Not ticked by default: import Streaming History for stronger evidence.');

    return {
      id: p.id,
      name: p.name,
      kind,
      ownerName: p.ownerName,
      trackCount: Math.max(p.itemsTotal, items.length),
      collaborative: p.collaborative,
      imageUrl: p.imageUrl,
      group,
      preselect,
      lastUsed,
      lastUsedSource,
      evidence,
      reasons,
      notes,
    };
  });

  playlists.sort(
    (a, b) =>
      (a.lastUsed ? Date.parse(a.lastUsed) : 0) - (b.lastUsed ? Date.parse(b.lastUsed) : 0) || a.name.localeCompare(b.name),
  );

  return {
    months: opts.months,
    cutoff: cutoff.toISOString(),
    generatedAt: opts.now.toISOString(),
    history: input.history,
    recentPlaysSince: input.recentPlaysSince,
    excludedGenerated: input.playlists.length - active.length,
    playlists,
  };
}
