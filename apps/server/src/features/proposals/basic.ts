// Basic Proposals: simple playlists built by rules (tags, tempo, era, energy,
// old likes) for people who do not use an Agent. See docs/adr/0003.
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  BASIC_PROPOSAL_ID_PREFIX,
  PROPOSAL_LIMITS,
  PROPOSALS_FILE_EXISTS,
  PROPOSALS_VERSION,
  type Proposal,
  type ProposalRules,
  type ProposalTheme,
  type ProposalsFile,
  type Snapshot,
  type SnapshotTrack,
} from '@curator/shared';
import type { DB } from '../../db/db.ts';
import { buildSnapshot } from '../enrich/snapshot.ts';
import { ProposalError, defaultPaths, snapshotGeneratedAt, type ProposalPaths } from './service.ts';

export const BASIC_LIMITS = {
  maxProposals: 12,
  /** Genre clusters accepted before the other kinds get a turn. */
  firstGenres: 4,
  maxGenres: 8,
  maxTempoBands: 2,
  /** Rules can only guess; an Agent's Proposals should look more certain. */
  maxConfidence: 0.6,
  /** Enough tracks with BPM or energy to make tempo and mood lists. */
  minFeatureTracks: 30,
  minFeatureShare: 0.4,
} as const;

/** Tags that are too broad to make a good playlist on their own. */
const GENERIC_TAGS = new Set(['electronic', 'electronica', 'pop', 'rock', 'dance', 'alternative', 'indie', 'world', 'instrumental']);
/** Tags that describe the listener or the artist, not the music. */
const NON_GENRE_TAGS = new Set([
  'seen live', 'favorites', 'favourites', 'favorite', 'favourite', 'love', 'beautiful', 'awesome', 'cover', 'covers',
  'female vocalists', 'male vocalists', 'female vocalist', 'male vocalist', 'singer songwriter',
  'british', 'american', 'english', 'canadian', 'german', 'french', 'swedish', 'australian', 'usa', 'uk',
]);
const UPPER_WORDS = new Set(['uk', 'us', 'edm', 'idm', 'ebm', 'dj', 'mc', 'r&b', 'rnb', 'nyc', 'lo', 'fi']);

// ---- small helpers ---------------------------------------------------------------------

const normTag = (tag: string) => tag.toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
const isGenreTag = (key: string) =>
  key.length >= 2 && !NON_GENRE_TAGS.has(key) && !/^'?\d{2,4}s?$/.test(key) && !/^\d+$/.test(key);

export function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) =>
      w
        .split('-')
        .map((p) => (UPPER_WORDS.has(p.toLowerCase()) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)))
        .join('-'),
    )
    .join(' ');
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 100) : 0);
const bpmOf = (t: SnapshotTrack) => (t.bpm != null ? Math.round(t.bpm) : null);
const decadeOf = (t: SnapshotTrack) => (t.year ? Math.floor(t.year / 10) * 10 : null);
const join = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const byId = (a: SnapshotTrack, b: SnapshotTrack) => a.id.localeCompare(b.id);

/** How much the user seems to care about a track: plays, top lists, playlists. */
const affinity = (t: SnapshotTrack) => (t.plays12m ?? 0) + (t.top ? 25 : 0) + (t.pl?.length ?? 0) * 2 + (t.liked ? 1 : 0);

/**
 * Keeps the order but avoids the same artist twice in a row when possible. An
 * artist with half of the remaining tracks goes next, so the end has no run.
 */
export function spreadArtists<T extends { artists: string[] }>(tracks: T[]): T[] {
  const rest = [...tracks];
  const out: T[] = [];
  const main = (t: T) => t.artists[0] ?? '';
  while (rest.length > 0) {
    const prev = out.at(-1);
    const clash = (t: T) => prev !== undefined && t.artists.some((a) => prev.artists.includes(a));
    const counts = new Map<string, number>();
    for (const t of rest) counts.set(main(t), (counts.get(main(t)) ?? 0) + 1);
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    let i = n * 2 >= rest.length + 1 ? rest.findIndex((t) => main(t) === top && !clash(t)) : -1;
    if (i < 0) i = rest.findIndex((t) => !clash(t));
    if (i < 0) i = 0;
    out.push(rest.splice(i, 1)[0]!);
  }
  return out;
}

const byBpm = (a: SnapshotTrack, b: SnapshotTrack) =>
  (bpmOf(a) ?? Infinity) - (bpmOf(b) ?? Infinity) || (a.cam ?? '').localeCompare(b.cam ?? '') || byId(a, b);

/** [p10, p90] of the BPMs, or null. */
function bpmSpan(tracks: SnapshotTrack[]): [number, number] | null {
  const bpms = tracks.map(bpmOf).filter((b): b is number => b != null).sort((a, b) => a - b);
  if (bpms.length === 0) return null;
  return [bpms[Math.floor((bpms.length - 1) * 0.1)]!, bpms[Math.ceil((bpms.length - 1) * 0.9)]!];
}

/** The decade that holds at least `share` of the tracks with a year, or null. */
function dominantDecade(tracks: SnapshotTrack[], share: number): number | null {
  const counts = new Map<number, number>();
  for (const t of tracks) {
    const d = decadeOf(t);
    if (d != null) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((s, n) => s + n, 0);
  const [best] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return best && total >= PROPOSAL_LIMITS.minTracks && best[1] / total >= share ? best[0] : null;
}

// ---- candidates ----------------------------------------------------------------------

interface Candidate {
  key: string;
  theme: ProposalTheme;
  name: string;
  description: string;
  rules: ProposalRules;
  confidence: number;
  /** All matching tracks, best first. Trimming drops from the end. */
  ranked: SnapshotTrack[];
  /** Playback order of the final tracks (before the artist spread). */
  order: (a: SnapshotTrack, b: SnapshotTrack) => number;
  reason: (t: SnapshotTrack) => string;
  /** Evidence text; `n` is the final number of tracks. */
  rationale: (n: number) => string;
}

const left = (n: number, matched: number) =>
  n < matched ? ` ${n} are here; the others are in other Proposals or over the ${PROPOSAL_LIMITS.maxTracks}-track limit.` : '';

interface TagCluster {
  key: string;
  label: string;
  /** Normalised tags in the cluster: the tag itself and its sub-genres. */
  keys: string[];
  generic: boolean;
  /** Track id -> best tag position (0 = most relevant). */
  pos: Map<string, number>;
  /** Track id -> the original tag that matched. */
  matchedTag: Map<string, string>;
}

/**
 * One cluster per genre tag. A tag also takes its sub-genres when its words end
 * the sub-genre's words ("east coast hip hop" joins "hip hop"), except for broad
 * tags like "rock", so "indie rock" stays apart.
 */
export function tagClusters(tracks: SnapshotTrack[]): TagCluster[] {
  const tags = new Map<string, { spellings: Map<string, number>; pos: Map<string, number>; orig: Map<string, string> }>();
  for (const t of tracks)
    (t.tags ?? []).forEach((tag, i) => {
      const key = normTag(tag);
      if (!isGenreTag(key)) return;
      const e = tags.get(key) ?? { spellings: new Map(), pos: new Map(), orig: new Map() };
      e.spellings.set(tag, (e.spellings.get(tag) ?? 0) + 1);
      if (!e.pos.has(t.id) || e.pos.get(t.id)! > i) {
        e.pos.set(t.id, i);
        e.orig.set(t.id, tag);
      }
      tags.set(key, e);
    });

  const keys = [...tags.keys()].sort();
  const parentOf = (k: string) =>
    keys
      .filter((p) => p !== k && !GENERIC_TAGS.has(p) && k.endsWith(` ${p}`))
      .sort((a, b) => b.length - a.length)[0];
  const children = new Map<string, string[]>();
  for (const k of keys) {
    const p = parentOf(k);
    if (p) children.set(p, [...(children.get(p) ?? []), k]);
  }
  const spelling = (k: string) =>
    [...tags.get(k)!.spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];

  return keys.map((key) => {
    const members = [key, ...(children.get(key) ?? [])];
    const pos = new Map<string, number>();
    const matchedTag = new Map<string, string>();
    for (const m of members)
      for (const [id, i] of tags.get(m)!.pos)
        if (!pos.has(id) || pos.get(id)! > i) {
          pos.set(id, i);
          matchedTag.set(id, tags.get(m)!.orig.get(id)!);
        }
    // Name the cluster after a sub-genre that covers most of it ("house" -> "Deep House").
    const main = members
      .map((m) => ({ m, n: tags.get(m)!.pos.size }))
      .filter(({ m, n }) => m === key || n >= pos.size * 0.8)
      .sort((a, b) => b.n - a.n || b.m.length - a.m.length)[0]!.m;
    return { key, label: spelling(main), keys: members, generic: GENERIC_TAGS.has(key), pos, matchedTag };
  });
}

/** Average tag position: lower means the tag is more central to its tracks. */
const meanPos = (c: TagCluster) => [...c.pos.values()].reduce((s, i) => s + i, 0) / Math.max(1, c.pos.size);

function genreCandidate(c: TagCluster, byTrack: Map<string, SnapshotTrack>): Candidate {
  const tracks = [...c.pos.keys()].map((id) => byTrack.get(id)!);
  const ranked = [...tracks].sort((a, b) => c.pos.get(a.id)! - c.pos.get(b.id)! || affinity(b) - affinity(a) || byId(a, b));
  const label = titleCase(c.label);
  const decade = /\d/.test(label) ? null : dominantDecade(tracks, 0.6);
  const span = bpmSpan(tracks);
  const withBpm = tracks.filter((t) => t.bpm != null).length;
  const tight = !decade && span && withBpm >= tracks.length * 0.7 && span[1] - span[0] <= 8 ? span : null;
  const name = decade ? `${decade}s ${label}` : tight ? `${label} ${tight[0]}–${tight[1]}` : label;
  const subs = c.keys.length > 1 ? ` (with ${c.keys.slice(1, 4).join(', ')})` : '';
  const rules: ProposalRules = { tags: c.keys.slice(0, 5) };
  if (decade) rules.years = [decade, decade + 9];
  if (tight) rules.bpm = tight;
  return {
    key: name,
    theme: 'genre',
    name,
    description: `${label} from your Library, ordered by tempo.`,
    rules,
    confidence: round2(Math.min(BASIC_LIMITS.maxConfidence, 0.35 + tracks.length / 400)),
    ranked,
    order: byBpm,
    reason: (t) => join([c.matchedTag.get(t.id), t.year ? String(t.year) : null, bpmOf(t) != null && `${bpmOf(t)} BPM`]),
    rationale: (n) =>
      `${tracks.length} tracks in your Library are tagged ${c.key}${subs}.` +
      (decade ? ` ${pct(tracks.filter((t) => decadeOf(t) === decade).length, tracks.filter((t) => t.year).length)}% are from the ${decade}s.` : '') +
      (tight ? ` Most sit between ${tight[0]} and ${tight[1]} BPM.` : '') +
      left(n, tracks.length),
  };
}

const TEMPO_WORDS: [maxCenter: number, word: string][] = [
  [90, 'Slow Burn'],
  [105, 'Laid-Back'],
  [118, 'Mid-Tempo'],
  [130, 'Club Tempo'],
  [145, 'Peak Time'],
  [165, 'Fast Lane'],
  [Infinity, 'Full Speed'],
];

/** Densest BPM windows (not overlapping, a few BPM apart), best first. */
export function tempoBands(tracks: SnapshotTrack[], max: number): [number, number][] {
  const bpms = tracks.map(bpmOf).filter((b): b is number => b != null);
  const count = (lo: number, hi: number) => bpms.filter((b) => b >= lo && b <= hi).length;
  const bands: [number, number][] = [];
  for (const width of [8, 12]) {
    if (bands.length >= max) break;
    const windows: { lo: number; n: number }[] = [];
    for (let lo = 60; lo <= 200; lo++) windows.push({ lo, n: count(lo, lo + width) });
    windows.sort((a, b) => b.n - a.n || a.lo - b.lo);
    for (const w of windows) {
      if (bands.length >= max || w.n < PROPOSAL_LIMITS.minTracks) break;
      const hi = w.lo + width;
      if (bands.every(([l, h]) => hi < l - 2 || w.lo > h + 2)) bands.push([w.lo, hi]);
    }
  }
  return bands;
}

function tempoCandidate([lo, hi]: [number, number], rank: number, tracks: SnapshotTrack[], withBpm: number): Candidate {
  const matched = tracks.filter((t) => bpmOf(t) != null && bpmOf(t)! >= lo && bpmOf(t)! <= hi);
  const word = TEMPO_WORDS.find(([c]) => (lo + hi) / 2 < c)![1];
  return {
    key: `${lo}-${hi}-bpm`,
    theme: 'tempo',
    name: `${word} ${lo}–${hi} BPM`,
    description: `Tracks between ${lo} and ${hi} BPM, ordered by tempo. Good for a steady run or a mix.`,
    rules: { bpm: [lo, hi] },
    confidence: 0.4,
    ranked: [...matched].sort((a, b) => affinity(b) - affinity(a) || byId(a, b)),
    order: byBpm,
    reason: (t) => join([`${bpmOf(t)} BPM`, t.cam]),
    rationale: (n) =>
      `${withBpm} of ${tracks.length} tracks (${pct(withBpm, tracks.length)}%) have a BPM; ${matched.length} of them fall between ${lo} and ${hi} BPM, ${rank === 0 ? 'the busiest' : 'a busy'} tempo range.` +
      left(n, matched.length),
  };
}

function eraCandidate(tracks: SnapshotTrack[]): Candidate | null {
  const dated = tracks.filter((t) => t.year);
  const counts = new Map<number, number>();
  for (const t of dated) counts.set(decadeOf(t)!, (counts.get(decadeOf(t)!) ?? 0) + 1);
  const [first, second] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  if (!first || dated.length === 0) return null;
  const share = first[1] / dated.length;
  // "Stands out": a big share, or clearly more than the next decade.
  if (!(share >= 0.35 || (share >= 0.25 && first[1] >= 1.5 * (second?.[1] ?? 0)))) return null;
  const decade = first[0];
  const matched = dated.filter((t) => decadeOf(t) === decade);
  return {
    key: `${decade}s`,
    theme: 'era',
    name: `Back to the ${decade}s`,
    description: `Music from ${decade}–${decade + 9} in your Library, oldest first.`,
    rules: { years: [decade, decade + 9] },
    confidence: 0.4,
    ranked: [...matched].sort((a, b) => affinity(b) - affinity(a) || byId(a, b)),
    order: (a, b) => (a.year ?? 0) - (b.year ?? 0) || byId(a, b),
    reason: (t) => join([String(t.year), t.tags?.[0]]),
    rationale: (n) =>
      `${matched.length} of the ${dated.length} tracks with a release year (${pct(matched.length, dated.length)}%) are from the ${decade}s` +
      (second ? `; the next decade, the ${second[0]}s, has ${second[1]}.` : '.') +
      left(n, matched.length),
  };
}

function moodCandidates(tracks: SnapshotTrack[], withEnergy: number): Candidate[] {
  const calm = tracks.filter((t) => t.energy != null && t.energy <= 0.4);
  const energetic = tracks.filter((t) => t.energy != null && t.energy >= 0.75 && (t.dance == null || t.dance >= 0.6));
  const hasDance = tracks.some((t) => t.dance != null);
  const energy = (t: SnapshotTrack) => t.energy ?? 0;
  return [
    {
      key: 'calm-evenings',
      theme: 'mood',
      name: 'Calm Evenings',
      description: 'Low-energy tracks for a quiet evening, winding down as it goes.',
      rules: { energy: [0, 0.4] },
      confidence: 0.45,
      ranked: [...calm].sort((a, b) => energy(a) - energy(b) || affinity(b) - affinity(a) || byId(a, b)),
      order: (a, b) => energy(b) - energy(a) || byId(a, b),
      reason: (t) => join([`energy ${energy(t).toFixed(2)}`, bpmOf(t) != null && `${bpmOf(t)} BPM`]),
      rationale: (n) => `${calm.length} of ${withEnergy} tracks with an energy value have energy 0.4 or lower.` + left(n, calm.length),
    },
    {
      key: 'high-energy',
      theme: 'mood',
      name: 'High Energy',
      description: 'Loud, driving tracks to get moving, building up as it goes.',
      rules: hasDance ? { energy: [0.75, 1], note: 'danceability 0.6 or higher where known' } : { energy: [0.75, 1] },
      confidence: 0.45,
      ranked: [...energetic].sort(
        (a, b) => energy(b) + (b.dance ?? 0) - (energy(a) + (a.dance ?? 0)) || affinity(b) - affinity(a) || byId(a, b),
      ),
      order: (a, b) => energy(a) - energy(b) || byId(a, b),
      reason: (t) => join([`energy ${energy(t).toFixed(2)}`, t.dance != null && `dance ${t.dance.toFixed(2)}`, bpmOf(t) != null && `${bpmOf(t)} BPM`]),
      rationale: (n) =>
        `${energetic.length} of ${withEnergy} tracks with an energy value have energy 0.75 or higher` +
        (hasDance ? ' and are danceable (0.6 or higher where known).' : '.') +
        left(n, energetic.length),
    },
  ];
}

function rediscoverCandidate(tracks: SnapshotTrack[], now: Date, hasHistory: boolean): Candidate {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const matched = tracks.filter((t) => t.liked && t.liked < cutoffDay && !t.top && (!hasHistory || !t.plays12m));
  const liked = tracks.filter((t) => t.liked).length;
  return {
    key: 'rediscover',
    theme: 'rediscover',
    name: 'Rediscover Old Likes',
    description: hasHistory
      ? 'Songs you liked more than two years ago and have not played in the last year.'
      : 'Songs you liked more than two years ago that are not in your top tracks.',
    rules: { note: hasHistory ? 'liked > 2 years ago, not in top tracks, no plays in 12 months' : 'liked > 2 years ago, not in top tracks' },
    confidence: 0.5,
    // Tracks you played once and then forgot first, then the oldest likes.
    ranked: [...matched].sort(
      (a, b) => Number(!a.lastPlayed) - Number(!b.lastPlayed) || a.liked!.localeCompare(b.liked!) || byId(a, b),
    ),
    order: (a, b) => a.liked!.localeCompare(b.liked!) || byId(a, b),
    reason: (t) => join([`liked ${t.liked!.slice(0, 7)}`, t.lastPlayed && `last played ${t.lastPlayed.slice(0, 7)}`]),
    rationale: (n) =>
      `${matched.length} of your ${liked} Liked Songs were liked before ${cutoffDay} and are not in your top tracks` +
      (hasHistory ? ', with no plays in the last 12 months (Streaming History).' : '. There is no Streaming History, so plays are not checked.') +
      left(n, matched.length),
  };
}

// ---- selection ---------------------------------------------------------------------------

/** Shared tracks may be at most a third of the smaller list. */
const tooClose = (shared: number, a: number, b: number) => shared * 3 > Math.min(a, b);

/**
 * Picks the candidate's tracks so that it shares at most a third with each
 * accepted list: first the tracks no other list uses, then shared ones within
 * that budget (best ranked first). Tries the biggest size that works. Null when
 * fewer than the minimum fit.
 */
function fit(c: Candidate, accepted: Set<string>[]): SnapshotTrack[] | null {
  let n = Math.min(PROPOSAL_LIMITS.maxTracks, c.ranked.length);
  while (n >= PROPOSAL_LIMITS.minTracks) {
    const budget = accepted.map((q) => Math.floor(Math.min(n, q.size) / 3));
    const chosen = new Set<string>();
    for (const t of c.ranked) if (chosen.size < n && accepted.every((q) => !q.has(t.id))) chosen.add(t.id);
    for (const t of c.ranked) {
      if (chosen.size >= n) break;
      if (chosen.has(t.id) || accepted.some((q, i) => q.has(t.id) && budget[i]! <= 0)) continue;
      chosen.add(t.id);
      accepted.forEach((q, i) => q.has(t.id) && budget[i]!--);
    }
    if (chosen.size === n) return c.ranked.filter((t) => chosen.has(t.id));
    // A smaller list has smaller budgets, so it can hold at most what fit now.
    n = Math.min(n - 1, chosen.size);
  }
  return null;
}

function toProposal(c: Candidate, tracks: SnapshotTrack[], id: string): Proposal {
  return {
    id,
    name: c.name.slice(0, PROPOSAL_LIMITS.name),
    description: c.description,
    theme: c.theme,
    rationale: c.rationale(tracks.length),
    rules: c.rules,
    tracks: spreadArtists([...tracks].sort(c.order)).map((t) => ({ id: t.id, reason: c.reason(t) })),
    confidence: Math.min(c.confidence, BASIC_LIMITS.maxConfidence),
  };
}

/**
 * Builds Basic Proposals from a Snapshot. Pure and deterministic: the same
 * Snapshot and `now` always give the same file.
 */
export function basicProposalsFromSnapshot(
  snapshot: Pick<Snapshot, 'tracks'> & { generatedAt?: string },
  now: Date,
): ProposalsFile {
  const tracks = [...snapshot.tracks].sort(byId);
  const byTrack = new Map(tracks.map((t) => [t.id, t]));
  const hasHistory = tracks.some((t) => t.lastPlayed);
  const enough = (n: number) => n >= BASIC_LIMITS.minFeatureTracks && n >= tracks.length * BASIC_LIMITS.minFeatureShare;
  const withBpm = tracks.filter((t) => t.bpm != null).length;
  const withEnergy = tracks.filter((t) => t.energy != null).length;

  const clusters = tagClusters(tracks)
    .filter((c) => c.pos.size >= PROPOSAL_LIMITS.minTracks)
    .sort(
      (a, b) =>
        Number(a.generic) - Number(b.generic) ||
        b.pos.size - a.pos.size ||
        meanPos(a) - meanPos(b) ||
        a.key.length - b.key.length ||
        a.key.localeCompare(b.key),
    );
  const genres = clusters.filter((c) => !c.generic).map((c) => genreCandidate(c, byTrack));
  const genericGenres = clusters.filter((c) => c.generic).map((c) => genreCandidate(c, byTrack));
  const era = eraCandidate(tracks);
  // Broad filters come after the first genres: they cut across them and are trimmed to fit.
  // More tempo windows than needed: the densest ones often repeat a genre list.
  const tempo = enough(withBpm) ? tempoBands(tracks, BASIC_LIMITS.maxTempoBands * 2).map((b, i) => tempoCandidate(b, i, tracks, withBpm)) : [];
  const others: Candidate[] = [
    ...(enough(withEnergy) ? moodCandidates(tracks, withEnergy) : []),
    ...(era ? [era] : []),
  ];

  const accepted: { c: Candidate; tracks: SnapshotTrack[]; ids: Set<string> }[] = [];
  let genreCount = 0;
  const tryAdd = (c: Candidate) => {
    if (accepted.length >= BASIC_LIMITS.maxProposals) return false;
    const fitted = fit(c, accepted.map((a) => a.ids));
    if (!fitted) return false;
    accepted.push({ c, tracks: fitted, ids: new Set(fitted.map((t) => t.id)) });
    return true;
  };
  let g = 0;
  for (; g < genres.length && genreCount < BASIC_LIMITS.firstGenres; g++) if (tryAdd(genres[g]!)) genreCount++;
  let tempoCount = 0;
  for (const c of tempo) if (tempoCount < BASIC_LIMITS.maxTempoBands && tryAdd(c)) tempoCount++;
  for (const c of others) tryAdd(c);
  for (; g < genres.length && genreCount < BASIC_LIMITS.maxGenres; g++) {
    // Keep the last slot for Rediscover.
    if (accepted.length >= BASIC_LIMITS.maxProposals - 1) break;
    if (tryAdd(genres[g]!)) genreCount++;
  }
  tryAdd(rediscoverCandidate(tracks, now, hasHistory));
  // Broad tags only when nothing better filled the page.
  for (const c of genericGenres) if (accepted.length < PROPOSAL_LIMITS.minProposals) tryAdd(c);

  const used = new Set<string>();
  const proposals = accepted.map(({ c, tracks: ts }) => {
    const base = `${BASIC_PROPOSAL_ID_PREFIX}${slug(c.key) || c.theme}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return toProposal(c, ts, id);
  });

  const generatedAt = now.toISOString();
  const kinds = [...new Set(proposals.map((p) => p.theme))].join(', ');
  return {
    version: PROPOSALS_VERSION,
    generatedAt,
    snapshotGeneratedAt: snapshot.generatedAt ?? generatedAt,
    generator: 'basic',
    summary:
      `Basic Proposals, built by simple rules (no AI agent) from ${tracks.length} tracks: ` +
      `${pct(tracks.filter((t) => t.tags?.length).length, tracks.length)}% have tags, ${pct(withBpm, tracks.length)}% have a BPM, ` +
      `${pct(withEnergy, tracks.length)}% have an energy value. ${proposals.length} lists by ${kinds || 'nothing yet'}. ` +
      'For more personal picks, run /propose-playlists with your AI agent.',
    proposals,
  };
}

/** Basic Proposals for the current Library in the DB. */
export function buildBasicProposals(db: DB, now: Date, opts: { snapshotGeneratedAt?: string | null } = {}): ProposalsFile {
  const snapshot = buildSnapshot(db, now);
  return basicProposalsFromSnapshot({ tracks: snapshot.tracks, generatedAt: opts.snapshotGeneratedAt ?? snapshot.generatedAt }, now);
}

/**
 * Writes Basic Proposals to data/proposals.json. Refuses (409) to overwrite an
 * existing file unless `replace` is set. Saved review states are kept by id.
 */
export function writeBasicProposals(
  db: DB,
  opts: { replace?: boolean; now?: Date; paths?: ProposalPaths } = {},
): { count: number; replaced: boolean } {
  const paths = opts.paths ?? defaultPaths();
  const exists = existsSync(paths.proposals);
  if (exists && !opts.replace)
    throw new ProposalError(
      409,
      'A proposals file already exists. Generating basic proposals replaces it; send replace: true to confirm.',
      PROPOSALS_FILE_EXISTS,
    );
  // Use the current Snapshot's time so the page does not report the file as out of date.
  const file = buildBasicProposals(db, opts.now ?? new Date(), { snapshotGeneratedAt: snapshotGeneratedAt(paths.snapshot) });
  if (file.proposals.length === 0)
    throw new ProposalError(
      400,
      `Not enough data for basic proposals: each list needs ${PROPOSAL_LIMITS.minTracks} matching tracks. Run Sync, then Enrich, and try again.`,
    );
  mkdirSync(dirname(paths.proposals), { recursive: true });
  writeFileSync(`${paths.proposals}.tmp`, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(`${paths.proposals}.tmp`, paths.proposals);
  return { count: file.proposals.length, replaced: exists };
}
