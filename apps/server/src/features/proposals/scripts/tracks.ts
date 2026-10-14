// Lists Snapshot tracks as compact one-line rows, with filters. For /propose-playlists.
// Usage: npx tsx apps/server/src/features/proposals/scripts/tracks.ts --help
import type { SnapshotTrack } from '@curator/shared';
import { loadSnapshot, parseArgs, parseRange } from './common.ts';

const HELP = `Filters (all optional, combined with AND):
  --tag a,b          has any of these tags (substring match: "house" matches "deep house")
  --all-tags a,b     has all of these tags
  --not-tag a,b      has none of these tags
  --artist a,b       first or any artist name contains one of these
  --bpm 118-128      tempo range (also "-100" or "160-")
  --energy 0.6-1     --valence 0-0.4   --dance 0.7-1   --acoustic 0.5-1   --instr 0.5-1
  --year 1990-1999   release year range
  --liked            only Liked Songs        --liked-before 2022-01-01   --liked-after 2025-06-01
  --not-played-since 2025-10-01   no play on or after this date (needs Streaming History)
  --plays 0-0        plays in the last 12 months
  --top              in any top-tracks list   --no-top   not in any
  --no-playlist      not in any Owned Playlist   --playlist <id>   in this Owned Playlist
  --ids a,b          only these track ids
  --sort bpm|energy|valence|year|liked|plays|top|name    (prefix "-" for descending, e.g. -energy)
  --limit 300        max rows (default 300)   --count   only print the count
  --file path        another snapshot.json
Row: id | artists — name | year | bpm cam | e/v/d | tags | liked | top s/m/l | plays12m last`;

const args = parseArgs(process.argv.slice(2));
if (args.has('help')) {
  console.log(HELP);
  process.exit(0);
}

const snap = loadSnapshot(args.get('file'));
const list = (k: string) =>
  args
    .get(k)
    ?.split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
const inRange = (v: number | undefined, r: [number, number] | null) => !r || (v != null && v >= r[0] && v <= r[1]);
const tagsOf = (t: SnapshotTrack) => (t.tags ?? []).map((x) => x.toLowerCase());

const anyTag = list('tag');
const allTags = list('all-tags');
const noTag = list('not-tag');
const artists = list('artist');
const ids = args.get('ids') ? new Set(args.get('ids')!.split(',').map((s) => s.trim())) : null;
const ranges = Object.fromEntries(
  ['bpm', 'energy', 'valence', 'dance', 'acoustic', 'instr', 'year', 'plays'].map((k) => [k, parseRange(args.get(k))]),
);

let rows = snap.tracks.filter((t) => {
  const tags = tagsOf(t);
  if (ids && !ids.has(t.id)) return false;
  if (anyTag && !anyTag.some((q) => tags.some((x) => x.includes(q)))) return false;
  if (allTags && !allTags.every((q) => tags.some((x) => x.includes(q)))) return false;
  if (noTag && noTag.some((q) => tags.some((x) => x.includes(q)))) return false;
  if (artists && !artists.some((q) => t.artists.some((a) => a.toLowerCase().includes(q)))) return false;
  if (!inRange(t.bpm, ranges.bpm!)) return false;
  if (!inRange(t.energy, ranges.energy!)) return false;
  if (!inRange(t.valence, ranges.valence!)) return false;
  if (!inRange(t.dance, ranges.dance!)) return false;
  if (!inRange(t.acoustic, ranges.acoustic!)) return false;
  if (!inRange(t.instr, ranges.instr!)) return false;
  if (!inRange(t.year, ranges.year!)) return false;
  if (ranges.plays && !inRange(t.plays12m ?? 0, ranges.plays)) return false;
  if (args.has('liked') && !t.liked) return false;
  if (args.has('liked-before') && !(t.liked && t.liked < args.get('liked-before')!)) return false;
  if (args.has('liked-after') && !(t.liked && t.liked >= args.get('liked-after')!)) return false;
  if (args.has('not-played-since') && t.lastPlayed && t.lastPlayed >= args.get('not-played-since')!) return false;
  const inTop = Boolean(t.top?.s || t.top?.m || t.top?.l);
  if (args.has('top') && !inTop) return false;
  if (args.has('no-top') && inTop) return false;
  if (args.has('no-playlist') && t.pl?.length) return false;
  if (args.has('playlist') && !t.pl?.includes(args.get('playlist')!)) return false;
  return true;
});

const sortKey = args.get('sort');
if (sortKey) {
  const desc = sortKey.startsWith('-');
  const key = sortKey.replace(/^-/, '');
  const value = (t: SnapshotTrack): number | string => {
    switch (key) {
      case 'bpm': return t.bpm ?? Infinity;
      case 'energy': return t.energy ?? Infinity;
      case 'valence': return t.valence ?? Infinity;
      case 'year': return t.year ?? Infinity;
      case 'liked': return t.liked ?? '9999';
      case 'plays': return t.plays12m ?? 0;
      case 'top': return Math.min(t.top?.s ?? 999, t.top?.m ?? 999, t.top?.l ?? 999);
      default: return `${t.artists[0] ?? ''} ${t.name}`.toLowerCase();
    }
  };
  rows = [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return desc ? -cmp : cmp;
  });
}

if (args.has('count')) {
  console.log(rows.length);
  process.exit(0);
}

const n2 = (x?: number) => (x == null ? '--' : x.toFixed(2).replace(/^0/, ''));
const fmt = (t: SnapshotTrack) => {
  const top = t.top ? `top ${t.top.s ?? '-'}/${t.top.m ?? '-'}/${t.top.l ?? '-'}` : '';
  const plays = t.plays12m != null || t.lastPlayed ? `p${t.plays12m ?? 0}${t.lastPlayed ? ` last ${t.lastPlayed.slice(0, 10)}` : ''}` : '';
  return [
    t.id,
    `${t.artists.join(', ')} — ${t.name}`,
    t.year ?? '----',
    `${t.bpm ? Math.round(t.bpm) : '---'} ${t.cam ?? '--'}`,
    `e${n2(t.energy)} v${n2(t.valence)} d${n2(t.dance)}`,
    (t.tags ?? []).slice(0, 4).join(', '),
    t.liked ? `liked ${t.liked.slice(0, 7)}` : '',
    top,
    plays,
  ]
    .filter((x) => x !== '')
    .join(' | ');
};

const limit = Number(args.get('limit') ?? 300);
for (const t of rows.slice(0, limit)) console.log(fmt(t));
console.log(`# ${rows.length} match${rows.length === 1 ? '' : 'es'}${rows.length > limit ? `, showing ${limit} (use --limit or narrower filters)` : ''}`);
