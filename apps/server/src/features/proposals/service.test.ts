import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProposalsFile } from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { SAMPLE_PROPOSALS, seedSampleLibrary } from './fixtures/seed.ts';
import { getProposals, patchProposal, readState, type ProposalPaths } from './service.ts';

const sample = () => JSON.parse(readFileSync(SAMPLE_PROPOSALS, 'utf8')) as ProposalsFile;

let db: DB;
let dir: string;
let paths: ProposalPaths;
const writeFile = (f: unknown) => writeFileSync(paths.proposals, typeof f === 'string' ? f : JSON.stringify(f));

beforeEach(() => {
  db = openDb(':memory:');
  seedSampleLibrary(db, { liked: true });
  dir = mkdtempSync(join(tmpdir(), 'proposals-'));
  paths = { proposals: join(dir, 'proposals.json'), snapshot: join(dir, 'snapshot.json') };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('getProposals', () => {
  it('reports a missing file', () => {
    const r = getProposals(db, paths);
    expect(r.file.status).toBe('missing');
    expect(r.proposals).toEqual([]);
  });

  it('reports an invalid file with errors', () => {
    writeFile({ version: 2 });
    const r = getProposals(db, paths);
    expect(r.file.status).toBe('invalid');
    expect(r.file.errors.length).toBeGreaterThan(0);
  });

  it('resolves tracks, stats, overlap with Owned Playlists and flags unknown ids', () => {
    const f = sample();
    const indie = f.proposals.find((p) => p.id === 'indie-sleaze-revival')!;
    indie.tracks.push({ id: 'abcdefghijklmnopqrstuv', reason: 'made up' });
    writeFile(f);
    writeFileSync(paths.snapshot, JSON.stringify({ generatedAt: '2026-10-13T18:05:12Z' }));
    db.prepare(
      `INSERT INTO playlists (id, name, owner_id, kind, items_readable, snapshot_id, synced_at)
       VALUES ('pl-indie', 'Indie Mix', 'me', 'owned', 1, 's', '2026-01-01')`,
    ).run();
    const ins = db.prepare('INSERT INTO playlist_items (playlist_id, position, track_id) VALUES (?, ?, ?)');
    indie.tracks.slice(0, 18).forEach((t, i) => ins.run('pl-indie', i, t.id));

    const r = getProposals(db, paths);
    expect(r.file.status).toBe('ok');
    expect(r.currentSnapshotAt).toBe('2026-10-13T18:05:12Z');
    expect(r.summary).toMatch(/six clear groups/);
    expect(r.counts.pending).toBe(8);

    const v = r.proposals.find((p) => p.id === 'indie-sleaze-revival')!;
    expect(v.tracks[0]).toMatchObject({ known: true, name: 'Last Nite', artists: ['The Strokes'], year: 2001, bpm: 104 });
    expect(v.tracks[0]!.camelot).toBe('8B');
    expect(v.tracks.at(-1)).toMatchObject({ known: false, reason: 'made up' });
    expect(v.stats).toMatchObject({ count: 23, unknown: 1, bpmMin: 101, bpmMax: 175 });
    expect(v.stats.topTags[0]).toBe('indie rock');
    expect(v.overlaps).toEqual([{ playlistId: 'pl-indie', name: 'Indie Mix', shared: 18, share: 18 / 23 }]);
    expect(v.issues.some((i) => i.level === 'error' && /not in the local Library/.test(i.message))).toBe(true);
  });
});

describe('patchProposal and state', () => {
  beforeEach(() => writeFile(sample()));

  it('stores status and edits, and drops edits that equal the original', () => {
    patchProposal(db, 'neon-drive-80s', { status: 'approved', name: 'Neon Nights' }, paths);
    let v = getProposals(db, paths).proposals.find((p) => p.id === 'neon-drive-80s')!;
    expect(v).toMatchObject({ status: 'approved', name: 'Neon Nights', edited: { name: true, description: false, tracks: false } });

    patchProposal(db, 'neon-drive-80s', { name: 'Neon Drive' }, paths);
    v = getProposals(db, paths).proposals.find((p) => p.id === 'neon-drive-80s')!;
    expect(v.edited.name).toBe(false);
    expect(readState(db, 'neon-drive-80s').edits).toEqual({});
  });

  it('applies track edits (remove + reorder) and allows fewer than 15 tracks', () => {
    const orig = sample().proposals.find((p) => p.id === 'neon-drive-80s')!.tracks.map((t) => t.id);
    const edited = [orig[2]!, orig[0]!, orig[1]!];
    patchProposal(db, 'neon-drive-80s', { trackIds: edited }, paths);
    const v = getProposals(db, paths).proposals.find((p) => p.id === 'neon-drive-80s')!;
    expect(v.tracks.map((t) => t.id)).toEqual(edited);
    expect(v.tracks[0]!.reason).toBe('Tears for Fears, 1985');
    expect(v.edited.tracks).toBe(true);
    expect(v.editsOutdated).toBe(false);
    expect(v.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('rejects bad edits', () => {
    expect(() => patchProposal(db, 'neon-drive-80s', { name: 'x'.repeat(101) }, paths)).toThrow(/1–100/);
    expect(() => patchProposal(db, 'neon-drive-80s', { trackIds: [] }, paths)).toThrow(/at least one/);
    expect(() => patchProposal(db, 'neon-drive-80s', { trackIds: ['abcdefghijklmnopqrstuv'] }, paths)).toThrow(/not in the local Library/);
    expect(() => patchProposal(db, 'nope', { status: 'approved' }, paths)).toThrow(/No proposal/);
  });

  it('reset clears edits and status', () => {
    patchProposal(db, 'neon-drive-80s', { status: 'dropped', description: 'Changed.' }, paths);
    patchProposal(db, 'neon-drive-80s', { reset: true }, paths);
    expect(readState(db, 'neon-drive-80s')).toEqual({ status: 'pending', edits: {}, spotifyPlaylistId: null });
  });

  it('keeps state across a regenerated file and remembers ids that disappear', () => {
    patchProposal(db, 'neon-drive-80s', { status: 'approved', name: 'Neon Nights' }, paths);
    patchProposal(db, 'sunday-jazz-funk', { status: 'dropped' }, paths);
    const orig = sample().proposals.find((p) => p.id === 'golden-era-boom-bap')!.tracks.map((t) => t.id);
    patchProposal(db, 'golden-era-boom-bap', { trackIds: orig.slice(1) }, paths);

    // The Agent writes a new file: one id is gone, one is new, one has new tracks.
    const next = sample();
    next.generatedAt = '2026-10-20T10:00:00Z';
    next.proposals = next.proposals.filter((p) => p.id !== 'sunday-jazz-funk');
    next.proposals.push({ ...next.proposals[0]!, id: 'brand-new-idea', name: 'Brand New Idea' });
    next.proposals.find((p) => p.id === 'golden-era-boom-bap')!.tracks.reverse();
    writeFile(next);

    let r = getProposals(db, paths);
    const byId = new Map(r.proposals.map((p) => [p.id, p]));
    expect(byId.get('neon-drive-80s')).toMatchObject({ status: 'approved', name: 'Neon Nights' });
    expect(byId.get('brand-new-idea')!.status).toBe('pending');
    expect(byId.has('sunday-jazz-funk')).toBe(false);
    expect(byId.get('golden-era-boom-bap')!.editsOutdated).toBe(true);

    // The old id comes back later: its state is still there.
    writeFile(sample());
    r = getProposals(db, paths);
    expect(r.proposals.find((p) => p.id === 'sunday-jazz-funk')!.status).toBe('dropped');
    expect(r.counts).toMatchObject({ approved: 1, dropped: 1 });
  });
});
