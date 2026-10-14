import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CREATED_BY_SUFFIX,
  descriptionForSpotify,
  validateProposals,
  type ProposalsFile,
  type ValidationContext,
} from '@curator/shared';
import { SAMPLE_PROPOSALS, sampleTracks } from './fixtures/seed.ts';

const sample = () => JSON.parse(readFileSync(SAMPLE_PROPOSALS, 'utf8')) as ProposalsFile;
const known = new Set(sampleTracks().map((t) => t.id));
const ctx: ValidationContext = { isKnownTrack: (id) => known.has(id) };
const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `fixture${String(from + i).padStart(15, '0')}`);

describe('validateProposals', () => {
  it('accepts the sample fixture without errors', () => {
    const r = validateProposals(sample(), ctx);
    expect(r.errors).toEqual([]);
    expect(r.usable).toBe(true);
    expect(r.file?.proposals).toHaveLength(8);
  });

  it('accepts raw JSON text and reports broken JSON', () => {
    expect(validateProposals(JSON.stringify(sample()), ctx).usable).toBe(true);
    const r = validateProposals('{"version": 1,', ctx);
    expect(r.usable).toBe(false);
    expect(r.errors[0]!.message).toMatch(/not valid JSON/);
  });

  it('rejects a wrong shape with paths', () => {
    const f = sample() as unknown as Record<string, any>;
    f.proposals[1].theme = 'vibes';
    f.proposals[2].tracks[0].id = 'not-an-id';
    f.proposals[3].id = 'Bad Id';
    delete f.summary;
    const r = validateProposals(f, ctx);
    expect(r.usable).toBe(false);
    const paths = r.errors.map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining(['summary', 'proposals.1.theme', 'proposals.2.tracks.0.id', 'proposals.3.id']),
    );
  });

  it('makes the file unusable when two proposals share an id', () => {
    const f = sample();
    f.proposals[1]!.id = f.proposals[0]!.id;
    const r = validateProposals(f, ctx);
    expect(r.usable).toBe(false);
    expect(r.errors.some((e) => /used twice/.test(e.message))).toBe(true);
  });

  it('flags unknown tracks, duplicates, track counts and length limits per proposal', () => {
    const f = sample();
    const p = f.proposals[0]!;
    p.name = 'x'.repeat(101);
    p.description = 'y'.repeat(301);
    p.tracks = [...ids(14).map((id) => ({ id })), { id: 'abcdefghijklmnopqrstuv' }, { id: ids(1)[0]! }];
    const r = validateProposals(f, ctx);
    expect(r.usable).toBe(true);
    const mine = r.errors.filter((e) => e.proposalId === p.id).map((e) => e.message);
    expect(mine).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Name has 101/),
        expect.stringMatching(/Description has 301/),
        expect.stringMatching(/abcdefghijklmnopqrstuv is not in the local Library/),
        expect.stringMatching(/listed twice \(also at position 1\)/),
      ]),
    );
    expect(r.errors.filter((e) => e.proposalId !== p.id)).toEqual([]);

    p.tracks = ids(10).map((id) => ({ id }));
    expect(validateProposals(f, ctx).errors.some((e) => /Has 10 tracks; use at least 15/.test(e.message))).toBe(true);
    p.tracks = ids(151).map((id) => ({ id }));
    expect(validateProposals(f, ctx).errors.some((e) => /Has 151 tracks; use at most 150/.test(e.message))).toBe(true);
  });

  it('warns about stale snapshots, long descriptions, overlaps and the proposal count', () => {
    const f = sample();
    f.proposals = f.proposals.slice(0, 3);
    f.proposals[0]!.description = 'z'.repeat(290);
    f.proposals[1]!.tracks = f.proposals[0]!.tracks.slice(0, 16);
    const r = validateProposals(f, {
      ...ctx,
      snapshotGeneratedAt: '2026-10-14T00:00:00Z',
      ownedPlaylists: [{ id: 'pl1', name: 'Indie Mix', trackIds: f.proposals[2]!.tracks.map((t) => t.id) }],
    });
    expect(r.errors).toEqual([]);
    const msgs = r.warnings.map((w) => w.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Has 3 proposals/),
        expect.stringMatching(/current Snapshot is from 2026-10-14/),
        expect.stringMatching(/will be shortened/),
        expect.stringMatching(/100% of its tracks are also in "After Hours Downtempo"/),
        expect.stringMatching(/100% of its tracks are already in the Owned Playlist "Indie Mix"/),
      ]),
    );
  });
});

describe('descriptionForSpotify', () => {
  it('adds the suffix and stays within 300 characters', () => {
    expect(descriptionForSpotify('Warm grooves.')).toBe(`Warm grooves.${CREATED_BY_SUFFIX}`);
    const long = descriptionForSpotify('a'.repeat(300));
    expect(long).toHaveLength(300);
    expect(long.endsWith(`…${CREATED_BY_SUFFIX}`)).toBe(true);
    expect(descriptionForSpotify('  ')).toBe('by Curator for Spotify');
  });
});
