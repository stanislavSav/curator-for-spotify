// Prints a compact digest of data/snapshot.json for an AI agent (/propose-playlists).
// Usage: npx tsx apps/server/src/features/proposals/scripts/digest.ts [path/to/snapshot.json]
import { existsSync, readFileSync } from 'node:fs';
import type { SnapshotTrack } from '@curator/shared';
import { PROPOSALS_PATH, countBy, histogram, loadSnapshot, median, openDbReadOnly } from './common.ts';

const snap = loadSnapshot(process.argv[2]);
const tracks = snap.tracks;
const now = Date.now();
const days = (iso: string) => Math.round((now - Date.parse(iso)) / 86_400_000);
const pct = (n: number) => `${Math.round((n / Math.max(1, tracks.length)) * 100)}%`;
const decade = (y?: number) => (y ? `${Math.floor(y / 10) * 10}s` : null);

// ---- freshness ----
console.log(`# Snapshot digest — ${snap.user}`);
console.log(`generatedAt ${snap.generatedAt} (${days(snap.generatedAt)} days ago)`);
const db = openDbReadOnly();
const lastJob = (kind: string) =>
  (db?.prepare("SELECT finished_at FROM jobs WHERE kind = ? AND status = 'done' ORDER BY finished_at DESC LIMIT 1").get(kind) as
    | { finished_at: string }
    | undefined)?.finished_at ?? null;
const lastSync = lastJob('sync');
const lastEnrich = lastJob('enrich');
const stale: string[] = [];
if (days(snap.generatedAt) > 14) stale.push('the Snapshot is older than 14 days');
if (lastSync && lastSync > snap.generatedAt) stale.push(`a Sync finished after it (${lastSync})`);
if (lastEnrich && lastEnrich > snap.generatedAt) stale.push(`an Enrich finished after it (${lastEnrich})`);
console.log(stale.length ? `FRESHNESS: STALE — ${stale.join('; ')}.` : 'FRESHNESS: ok');

const c = snap.coverage;
console.log(
  `coverage: ${c.tracks} tracks, features ${c.withFeatures} (${pct(c.withFeatures)}), tags ${c.withTags} (${pct(c.withTags)}), Streaming History ${c.withHistory} (${pct(c.withHistory)})`,
);

// ---- playlists ----
const owned = snap.playlists.filter((p) => p.kind === 'owned');
console.log(`\n## Owned Playlists (${owned.length}) — avoid near-duplicates of these`);
for (const p of owned) console.log(`- ${p.id} "${p.name}" (${p.n})${p.desc ? ` — ${p.desc.slice(0, 80)}` : ''}`);
const other = countBy(snap.playlists.filter((p) => p.kind !== 'owned'), (p) => p.kind);
if (other.length) console.log(`(also: ${other.map(([k, n]) => `${n} ${k}`).join(', ')})`);
const inNone = tracks.filter((t) => !t.pl?.length).length;
console.log(`tracks in no Owned Playlist: ${inNone} (${pct(inNone)})`);

// ---- top artists ----
console.log('\n## Top artists (Spotify)');
console.log(`short:  ${snap.topArtists.s.slice(0, 15).join(', ')}`);
console.log(`medium: ${snap.topArtists.m.slice(0, 15).join(', ')}`);
console.log(`long:   ${snap.topArtists.l.slice(0, 15).join(', ')}`);

const artistCounts = countBy(
  tracks.flatMap((t) => t.artists.slice(0, 1)),
  (a) => a,
).sort((a, b) => b[1] - a[1]);
console.log(`\n## Artists with most tracks (first-billed)\n${artistCounts.slice(0, 40).map(([a, n]) => `${a} ${n}`).join(' · ')}`);

// ---- tags ----
console.log(`\n## Tag counts (top 60 of ${snap.tagCounts.length})`);
console.log(snap.tagCounts.slice(0, 60).map(([t, n]) => `${t} ${n}`).join(' · '));

// ---- histograms ----
const order = (rows: [string, number][]) => rows.sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
histogram('Decades (release year)', order(countBy(tracks, (t) => decade(t.year) ?? 'unknown')));
histogram(
  'BPM (10-BPM bands)',
  order(countBy(tracks, (t) => (t.bpm ? `${Math.floor(t.bpm / 10) * 10}` : 'none'))),
);
histogram(
  'Energy (0–1)',
  order(countBy(tracks, (t) => (t.energy != null ? (Math.min(0.9, Math.floor(t.energy * 10) / 10)).toFixed(1) : 'none'))),
);
histogram(
  'Valence / mood (0 sad – 1 happy)',
  order(countBy(tracks, (t) => (t.valence != null ? (Math.min(0.9, Math.floor(t.valence * 10) / 10)).toFixed(1) : 'none'))),
);
histogram('Liked Songs by year added', order(countBy(tracks, (t) => t.liked?.slice(0, 4))));
if (c.withHistory > 0)
  histogram(
    'Plays in the last 12 months (Streaming History)',
    countBy(tracks, (t) => {
      const p = t.plays12m ?? 0;
      return p === 0 ? '0' : p < 5 ? '1-4' : p < 20 ? '5-19' : '20+';
    }).sort((a, b) => ['0', '1-4', '5-19', '20+'].indexOf(a[0]) - ['0', '1-4', '5-19', '20+'].indexOf(b[0])),
  );

// ---- clusters per tag ----
console.log('\n## Tag clusters (top 30 tags): count | median BPM | median energy | main decade | top artists');
const topTags = snap.tagCounts.slice(0, 30).map(([t]) => t);
for (const tag of topTags) {
  const ts = tracks.filter((t) => t.tags?.includes(tag));
  const bpm = median(ts.map((t) => t.bpm).filter((x): x is number => x != null));
  const energy = median(ts.map((t) => t.energy).filter((x): x is number => x != null));
  const dec = countBy(ts, (t) => decade(t.year)).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '?';
  const artists = countBy(ts, (t) => t.artists[0])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([a]) => a);
  console.log(
    `- ${tag}: ${ts.length} | ${bpm ?? '?'} | ${energy?.toFixed(2) ?? '?'} | ${dec} | ${artists.join(', ')}`,
  );
}

// ---- pools ----
const twoYearsAgo = new Date(now - 2 * 365 * 86_400_000).toISOString();
const isRecentlyPlayed = (t: SnapshotTrack) => (t.plays12m ?? 0) > 0 || (t.top?.s ?? 0) > 0 || (t.top?.m ?? 0) > 0;
const rediscover = tracks.filter((t) => t.liked && t.liked < twoYearsAgo && !isRecentlyPlayed(t));
const recentFavs = tracks.filter((t) => t.top?.s || (t.plays12m ?? 0) >= 10);
console.log('\n## Pools');
console.log(`rediscover (liked > 2 years ago, no plays in 12 months, not in short/medium top): ${rediscover.length}`);
if (c.withHistory === 0) console.log('  note: no Streaming History imported, so "not played" only means "not in top tracks".');
console.log(`recent favourites (short-term top or ≥10 plays in 12 months): ${recentFavs.length}`);
console.log(`liked in the last 90 days: ${tracks.filter((t) => t.liked && days(t.liked) <= 90).length}`);

// ---- previous proposals ----
if (existsSync(PROPOSALS_PATH)) {
  try {
    const prev = JSON.parse(readFileSync(PROPOSALS_PATH, 'utf8')) as { proposals?: { id: string; name: string }[] };
    const states = new Map(
      (
        (db?.prepare('SELECT proposal_id, status FROM proposal_state').all() ?? []) as {
          proposal_id: string;
          status: string;
        }[]
      ).map((r) => [r.proposal_id, r.status]),
    );
    console.log('\n## Previous data/proposals.json (keep ids for ideas you keep; do not re-propose created or dropped ones)');
    for (const p of prev.proposals ?? []) console.log(`- ${p.id} "${p.name}": ${states.get(p.id) ?? 'pending'}`);
    const gone = [...states.entries()].filter(([id]) => !(prev.proposals ?? []).some((p) => p.id === id));
    for (const [id, s] of gone) console.log(`- ${id} (not in file): ${s}`);
  } catch {
    console.log('\n(previous data/proposals.json exists but is not valid JSON)');
  }
}

console.log(`
## Next
List tracks with: npx tsx apps/server/src/features/proposals/scripts/tracks.ts --tag "house" --bpm 118-128 --sort bpm
Run it with --help for all filters.`);
