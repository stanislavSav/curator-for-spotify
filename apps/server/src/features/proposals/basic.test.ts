import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PROPOSALS_FILE_EXISTS,
  validateProposals,
  type Proposal,
  type ProposalsFile,
  type SnapshotTrack,
} from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import {
  basicProposalsFromSnapshot,
  buildBasicProposals,
  slug,
  spreadArtists,
  tagClusters,
  tempoBands,
  titleCase,
  writeBasicProposals,
} from './basic.ts';
import { SAMPLE_PROPOSALS, seedSampleLibrary } from './fixtures/seed.ts';
import { makeProposalsRoutes } from './routes.ts';
import { getProposals, patchProposal, readState, type ProposalPaths } from './service.ts';

const NOW = new Date('2026-10-14T12:00:00Z');

// ---- a synthetic Library with fake ids and fake names --------------------------------------

interface FakeTrack {
  id: string;
  artist: string;
  year: number;
  bpm: number | null;
  energy: number;
  dance: number;
  tags: string[];
  liked: string;
}

let seq = 0;
const fakeId = () => `basicfake${String(++seq).padStart(13, '0')}`;

function group(n: number, prefix: string, f: (i: number) => Omit<FakeTrack, 'id' | 'artist'>): FakeTrack[] {
  return Array.from({ length: n }, (_, i) => ({ id: fakeId(), artist: `${prefix} Artist ${i % 8}`, ...f(i) }));
}

const OLD = '2018-05-01T10:00:00Z';
const RECENT = '2026-06-01T10:00:00Z';

/** About 200 tracks in clear groups, with near-synonym and generic tags. */
function fakeLibrary(): FakeTrack[] {
  seq = 0;
  return [
    ...group(30, 'Rap', (i) => ({ year: 1990 + (i % 10), bpm: 86 + (i % 8), energy: 0.6, dance: 0.7, tags: ['hip hop'], liked: OLD })),
    ...group(20, 'Coast', (i) => ({ year: 1991 + (i % 9), bpm: 88 + (i % 6), energy: 0.62, dance: 0.72, tags: ['east coast hip hop'], liked: OLD })),
    ...group(40, 'House', (i) => ({ year: 2015 + (i % 5), bpm: 120 + (i % 6), energy: 0.8, dance: 0.85, tags: ['deep house', 'electronic'], liked: i < 10 ? RECENT : OLD })),
    ...group(25, 'Drone', (i) => ({ year: 2001 + (i % 9), bpm: 70 + (i % 9), energy: 0.12 + (i % 10) / 50, dance: 0.2, tags: ['ambient', 'electronic'], liked: OLD })),
    ...group(30, 'Guitar', (i) => ({ year: 2002 + (i % 6), bpm: 140 + i, energy: 0.88, dance: 0.65, tags: ['indie rock', 'garage rock revival', 'rock'], liked: OLD })),
    ...group(20, 'Soul', (i) => ({ year: 1992 + (i % 8), bpm: null, energy: 0.5, dance: 0.5, tags: ['neo soul'], liked: OLD })),
    ...group(20, 'Piano', (i) => ({ year: 1993 + (i % 6), bpm: 60 + (i % 8), energy: 0.2 + (i % 5) / 50, dance: 0.3, tags: ['singer songwriter'], liked: OLD })),
    ...group(25, 'Synth', (i) => ({ year: 2011 + (i % 9), bpm: 105 + (i % 12), energy: 0.8, dance: 0.7, tags: ['electronic'], liked: OLD })),
  ];
}

function seedFake(db: DB, tracks: FakeTrack[]) {
  const ins = {
    track: db.prepare('INSERT INTO tracks (id, uri, name, duration_ms, album_name, release_date) VALUES (?, ?, ?, ?, ?, ?)'),
    artist: db.prepare('INSERT OR IGNORE INTO artists (id, name) VALUES (?, ?)'),
    ta: db.prepare('INSERT INTO track_artists (track_id, artist_id, position) VALUES (?, ?, 0)'),
    feat: db.prepare(
      `INSERT INTO audio_features (track_id, source, tempo, key, mode, energy, danceability, fetched_at)
       VALUES (?, 'manual', ?, ?, 1, ?, ?, ?)`,
    ),
    tag: db.prepare("INSERT INTO tags (entity_type, entity_id, source, tag, weight) VALUES ('track', ?, 'musicbrainz', ?, ?)"),
    liked: db.prepare('INSERT INTO liked_tracks (track_id, added_at) VALUES (?, ?)'),
  };
  db.transaction(() => {
    tracks.forEach((t, n) => {
      const artistId = `fakeartist${slug(t.artist)}`;
      ins.track.run(t.id, `spotify:track:${t.id}`, `Fake Song ${n + 1}`, 200_000, 'Fake Album', `${t.year}-01-01`);
      ins.artist.run(artistId, t.artist);
      ins.ta.run(t.id, artistId);
      ins.feat.run(t.id, t.bpm, n % 12, t.energy, t.dance, NOW.toISOString());
      t.tags.forEach((tag, i) => ins.tag.run(t.id, tag, 1 - i * 0.1));
      ins.liked.run(t.id, t.liked);
    });
  })();
}

const play = (db: DB, id: string, ts: string) =>
  db.prepare('INSERT INTO stream_history (ts, track_uri, ms_played) VALUES (?, ?, 60000)').run(ts, `spotify:track:${id}`);

function knownIds(db: DB) {
  const ids = new Set((db.prepare('SELECT id FROM tracks').all() as { id: string }[]).map((r) => r.id));
  return { isKnownTrack: (id: string) => ids.has(id) };
}

const trackIds = (p: Proposal) => p.tracks.map((t) => t.id);

/** Shared properties every generated file must have. */
function expectWellFormed(db: DB, file: ProposalsFile, artistOf: (id: string) => string) {
  const v = validateProposals(JSON.stringify(file), knownIds(db));
  expect(v.errors).toEqual([]);
  expect(v.usable).toBe(true);
  expect(file.generator).toBe('basic');
  expect(file.proposals.length).toBeGreaterThanOrEqual(6);
  expect(file.proposals.length).toBeLessThanOrEqual(12);
  for (const p of file.proposals) {
    expect(p.id).toMatch(/^basic-[a-z0-9-]+$/);
    expect(p.confidence).toBeLessThanOrEqual(0.6);
    expect(p.tracks.length).toBeGreaterThanOrEqual(15);
    expect(p.tracks.length).toBeLessThanOrEqual(150);
    expect(p.rationale).toMatch(/\d/);
    expect(p.tracks.every((t) => t.reason)).toBe(true);
    const sameArtistInARow = p.tracks.filter((t, i) => i > 0 && artistOf(t.id) === artistOf(p.tracks[i - 1]!.id));
    expect(sameArtistInARow, p.name).toEqual([]);
  }
  for (const [i, a] of file.proposals.entries())
    for (const b of file.proposals.slice(i + 1)) {
      const shared = trackIds(a).filter((id) => trackIds(b).includes(id)).length;
      expect(shared * 3, `${a.name} / ${b.name}`).toBeLessThanOrEqual(Math.min(a.tracks.length, b.tracks.length));
    }
}

// ---- helpers -------------------------------------------------------------------------------

describe('helpers', () => {
  it('titleCase and slug', () => {
    expect(titleCase('deep house')).toBe('Deep House');
    expect(titleCase('synth-pop')).toBe('Synth-Pop');
    expect(titleCase('uk garage')).toBe('UK Garage');
    expect(slug('Club Tempo 120–128 BPM')).toBe('club-tempo-120-128-bpm');
    expect(slug('1990s Hip Hop')).toBe('1990s-hip-hop');
  });

  it('spreadArtists keeps the order but avoids the same artist twice in a row', () => {
    const t = (id: string, a: string) => ({ id, artists: [a] });
    const out = spreadArtists([t('1', 'A'), t('2', 'A'), t('3', 'B'), t('4', 'A'), t('5', 'C')]);
    expect(out.map((x) => x.id)).toEqual(['1', '3', '2', '5', '4']);
    // Only one artist left: no way around it.
    expect(spreadArtists([t('1', 'A'), t('2', 'A')]).map((x) => x.id)).toEqual(['1', '2']);
  });

  it('tagClusters merges sub-genres into their parent, but not into broad tags', () => {
    const st = (id: string, tags: string[]): SnapshotTrack => ({ id, name: id, artists: ['x'], dur: 200, tags });
    const clusters = tagClusters([
      st('a', ['hip hop']),
      st('b', ['East Coast Hip-Hop']),
      st('c', ['indie rock', 'rock']),
      st('d', ['80s', 'seen live', 'new wave']),
    ]);
    const hipHop = clusters.find((c) => c.key === 'hip hop')!;
    expect([...hipHop.pos.keys()].sort()).toEqual(['a', 'b']);
    expect(clusters.find((c) => c.key === 'rock')!.pos.size).toBe(1);
    expect(clusters.map((c) => c.key)).not.toContain('80s');
    expect(clusters.map((c) => c.key)).not.toContain('seen live');
  });

  it('tempoBands finds the densest windows, far apart', () => {
    const st = (i: number, bpm: number): SnapshotTrack => ({ id: `t${i}`, name: '', artists: [], dur: 1, bpm });
    const tracks = [
      ...Array.from({ length: 30 }, (_, i) => st(i, 122 + (i % 5))),
      ...Array.from({ length: 20 }, (_, i) => st(100 + i, 90 + (i % 4))),
      ...Array.from({ length: 5 }, (_, i) => st(200 + i, 170)),
    ];
    const bands = tempoBands(tracks, 2);
    expect(bands).toHaveLength(2);
    expect(bands[0]![0]).toBeLessThanOrEqual(122);
    expect(bands[0]![1]).toBeGreaterThanOrEqual(126);
    expect(bands[1]![0]).toBeLessThanOrEqual(90);
  });
});

// ---- the generator over a DB -----------------------------------------------------------------

describe('buildBasicProposals', () => {
  it('builds valid, spread-out Proposals from the sample Library', () => {
    const db = openDb(':memory:');
    const sample = seedSampleLibrary(db, { liked: true });
    const artist = new Map(sample.map((t) => [t.id, t.artists[0]!]));
    const file = buildBasicProposals(db, NOW);
    expectWellFormed(db, file, (id) => artist.get(id)!);
    expect(JSON.stringify(buildBasicProposals(db, NOW))).toBe(JSON.stringify(file));
  });

  describe('with a richer fake Library', () => {
    let db: DB;
    let tracks: FakeTrack[];
    let file: ProposalsFile;
    const find = (re: RegExp) => file.proposals.find((p) => re.test(p.name));
    const byId = () => new Map(tracks.map((t) => [t.id, t]));

    beforeEach(() => {
      db = openDb(':memory:');
      tracks = fakeLibrary();
      seedFake(db, tracks);
      // Streaming History: one old like played this year, one played only in 2023.
      play(db, tracks[0]!.id, '2026-05-01T10:00:00Z');
      play(db, tracks[1]!.id, '2023-03-01T10:00:00Z');
      // A top track is never "forgotten".
      db.prepare("INSERT INTO top_tracks (time_range, rank, track_id) VALUES ('long_term', 1, ?)").run(tracks[2]!.id);
      file = buildBasicProposals(db, NOW);
    });

    it('passes the validator and the shape rules', () => {
      const m = byId();
      expectWellFormed(db, file, (id) => m.get(id)!.artist);
    });

    it('is deterministic', () => {
      expect(JSON.stringify(buildBasicProposals(db, NOW))).toBe(JSON.stringify(file));
    });

    it('merges near-synonym tags and names the era when one decade dominates', () => {
      const hipHop = find(/Hip Hop/)!;
      expect(hipHop.name).toBe('1990s Hip Hop');
      expect(hipHop.theme).toBe('genre');
      const eastCoast = new Set(tracks.filter((t) => t.tags[0] === 'east coast hip hop').map((t) => t.id));
      expect(hipHop.tracks.some((t) => eastCoast.has(t.id))).toBe(true);
      expect(file.proposals.filter((p) => /Hip Hop/.test(p.name))).toHaveLength(1);
    });

    it('skips broad tags and near-duplicate genres', () => {
      expect(file.proposals.map((p) => p.name)).not.toContain('Electronic');
      expect(file.proposals.filter((p) => /Indie Rock|Garage Rock/.test(p.name))).toHaveLength(1);
      expect(find(/Deep House/)).toBeTruthy();
    });

    it('adds a tempo band in BPM order, a mood pair and an era list', () => {
      const m = byId();
      const tempo = file.proposals.find((p) => p.theme === 'tempo')!;
      const [lo, hi] = tempo.rules!.bpm!;
      const bpms = tempo.tracks.map((t) => m.get(t.id)!.bpm);
      expect(bpms.every((b) => b != null && b >= lo && b <= hi)).toBe(true);
      expect(bpms[0]!).toBeLessThanOrEqual(bpms.at(-1)!);
      expect(tempo.tracks[0]!.reason).toMatch(/^\d+ BPM · \d+[AB]$/);
      expect(tempo.name).toMatch(/\d+–\d+ BPM$/);

      const calm = find(/Calm Evenings/)!;
      expect(calm.tracks.every((t) => m.get(t.id)!.energy <= 0.4)).toBe(true);
      const energetic = find(/High Energy/)!;
      expect(energetic.tracks.every((t) => m.get(t.id)!.energy >= 0.75 && m.get(t.id)!.dance >= 0.6)).toBe(true);

      const era = file.proposals.find((p) => p.theme === 'era')!;
      expect(era.name).toBe('Back to the 1990s');
      expect(era.tracks.every((t) => m.get(t.id)!.year >= 1990 && m.get(t.id)!.year <= 1999)).toBe(true);
    });

    it('Rediscover: old likes that are not top tracks and not played in 12 months', () => {
      const re = file.proposals.find((p) => p.theme === 'rediscover')!;
      const ids = new Set(trackIds(re));
      const m = byId();
      expect(ids.has(tracks[0]!.id)).toBe(false); // played this year
      expect(ids.has(tracks[1]!.id)).toBe(true); // last played in 2023
      expect(ids.has(tracks[2]!.id)).toBe(false); // top track
      expect([...ids].every((id) => m.get(id)!.liked === OLD)).toBe(true);
      expect(re.rationale).toMatch(/no plays in the last 12 months/);
      expect(re.tracks.find((t) => t.id === tracks[1]!.id)!.reason).toMatch(/last played 2023-03/);
    });

    it('uses the given Snapshot time', () => {
      const f = buildBasicProposals(db, NOW, { snapshotGeneratedAt: '2026-10-01T08:00:00Z' });
      expect(f.snapshotGeneratedAt).toBe('2026-10-01T08:00:00Z');
      expect(f.generatedAt).toBe(NOW.toISOString());
    });
  });

  it('returns no Proposals for an empty Library', () => {
    expect(buildBasicProposals(openDb(':memory:'), NOW).proposals).toEqual([]);
  });
});

describe('basicProposalsFromSnapshot', () => {
  const st = (i: number, over: Partial<SnapshotTrack> = {}): SnapshotTrack => ({
    id: `snapfake${String(i).padStart(14, '0')}`,
    name: `Fake ${i}`,
    artists: [`Artist ${i % 20}`],
    dur: 200,
    ...over,
  });

  it('caps a big cluster at 150 tracks', () => {
    const tracks = Array.from({ length: 400 }, (_, i) => st(i, { tags: ['techno'], year: 1995 + (i % 20) }));
    const techno = basicProposalsFromSnapshot({ tracks }, NOW).proposals.find((p) => p.name === 'Techno')!;
    expect(techno.tracks).toHaveLength(150);
  });

  it('Rediscover without Streaming History only checks likes and top tracks', () => {
    const tracks = Array.from({ length: 40 }, (_, i) =>
      st(i, { liked: i < 30 ? '2019-01-01' : '2026-01-01', top: i === 0 ? { l: 3 } : undefined }),
    );
    const re = basicProposalsFromSnapshot({ tracks }, NOW).proposals.find((p) => p.theme === 'rediscover')!;
    expect(re.tracks).toHaveLength(29);
    expect(re.rationale).toMatch(/no Streaming History/);
  });

  it('uses broad tags only when nothing better fills the page', () => {
    const tracks = Array.from({ length: 40 }, (_, i) => st(i, { tags: ['pop'] }));
    const names = basicProposalsFromSnapshot({ tracks }, NOW).proposals.map((p) => p.name);
    expect(names).toContain('Pop');
  });
});

// ---- writing the file and the route -------------------------------------------------------

describe('writing the file', () => {
  let db: DB;
  let dir: string;
  let paths: ProposalPaths;
  const app = () => makeProposalsRoutes({ db: () => db, paths: () => paths });
  const post = (body?: unknown) =>
    app().request('/basic', {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });

  beforeEach(() => {
    db = openDb(':memory:');
    seedSampleLibrary(db, { liked: true });
    dir = mkdtempSync(join(tmpdir(), 'basic-proposals-'));
    paths = { proposals: join(dir, 'proposals.json'), snapshot: join(dir, 'snapshot.json') };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('POST /basic writes the file, and the page shows it as basic', async () => {
    writeFileSync(paths.snapshot, JSON.stringify({ generatedAt: '2026-10-13T18:05:12Z' }));
    const res = await post({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; replaced: boolean };
    expect(body.replaced).toBe(false);
    expect(body.count).toBeGreaterThanOrEqual(6);

    const r = getProposals(db, paths);
    expect(r.file.status).toBe('ok');
    expect(r.file.generator).toBe('basic');
    expect(r.file.errors).toEqual([]);
    // Built at the current Snapshot's time, so it is not reported as out of date.
    expect(r.file.snapshotGeneratedAt).toBe('2026-10-13T18:05:12Z');
    expect(r.file.warnings).toEqual([]);
    expect(r.proposals).toHaveLength(body.count);
  });

  it('accepts an empty body', async () => {
    const res = await app().request('/basic', { method: 'POST' });
    expect(res.status).toBe(200);
  });

  it('returns 409 when a file exists, and replaces it with replace: true, keeping saved states', async () => {
    writeFileSync(paths.proposals, readFileSync(SAMPLE_PROPOSALS));
    const res = await post({});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: PROPOSALS_FILE_EXISTS, error: expect.stringMatching(/already exists/) });
    expect(getProposals(db, paths).file.generator).toBe('agent');

    // A decision on an Agent Proposal survives the replace (states are kept by id).
    patchProposal(db, 'neon-drive-80s', { status: 'approved' }, paths);
    const replaced = await post({ replace: true });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({ replaced: true });
    expect(getProposals(db, paths).file.generator).toBe('basic');
    expect(readState(db, 'neon-drive-80s').status).toBe('approved');
  });

  it('rejects a bad body', async () => {
    expect((await post({ replace: 'yes' })).status).toBe(400);
    expect(existsSync(paths.proposals)).toBe(false);
  });

  it('refuses when the Library is too small', () => {
    const empty = openDb(':memory:');
    expect(() => writeBasicProposals(empty, { paths, now: NOW })).toThrow(/Not enough data/);
    expect(existsSync(paths.proposals)).toBe(false);
  });

  it('old files without a generator stay valid and count as written by an Agent', () => {
    const raw = JSON.parse(readFileSync(SAMPLE_PROPOSALS, 'utf8')) as ProposalsFile;
    expect(raw.generator).toBeUndefined();
    expect(validateProposals(raw, knownIds(db)).usable).toBe(true);
    writeFileSync(paths.proposals, JSON.stringify(raw));
    expect(getProposals(db, paths).file.generator).toBe('agent');
  });
});
