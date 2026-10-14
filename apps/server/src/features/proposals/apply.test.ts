import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProposalsFile } from '@curator/shared';
import { openDb, type DB } from '../../db/db.ts';
import { SpotifyClient } from '../../spotify/client.ts';
import { SAMPLE_PROPOSALS, seedSampleLibrary } from './fixtures/seed.ts';
import { applicableIds, applyProposals, applySummary, patchProposal, readState, type ProposalPaths } from './service.ts';

let db: DB;
let dir: string;
let paths: ProposalPaths;
let calls: { method: string; path: string; body: any }[];
let failOnName: string | null;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  calls.push({ method: init?.method ?? 'GET', path: url.pathname, body });
  if (url.pathname === '/v1/me/playlists' && init?.method === 'POST') {
    if (body.name === failOnName) return new Response('{"error":"boom"}', { status: 400 });
    const id = `pl${calls.length}`;
    return Response.json({ id, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` } }, { status: 201 });
  }
  if (/\/v1\/playlists\/.+\/items/.test(url.pathname)) return Response.json({ snapshot_id: 'x' }, { status: 201 });
  return new Response('not found', { status: 404 });
};

beforeEach(() => {
  db = openDb(':memory:');
  seedSampleLibrary(db, { liked: true });
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, authorized_at)
     VALUES (1, 'tok', 'ref', ?, '', '2026-10-01T00:00:00Z')`,
  ).run(Date.now() + 3600_000);
  dir = mkdtempSync(join(tmpdir(), 'proposals-apply-'));
  paths = { proposals: join(dir, 'proposals.json'), snapshot: join(dir, 'snapshot.json') };
  writeFileSync(paths.proposals, readFileSync(SAMPLE_PROPOSALS, 'utf8'));
  calls = [];
  failOnName = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const client = () => new SpotifyClient(db, fakeFetch, 0);
const sampleFile = () => JSON.parse(readFileSync(SAMPLE_PROPOSALS, 'utf8')) as ProposalsFile;

describe('applyProposals', () => {
  it('creates approved proposals with edits applied and saves the Spotify id', async () => {
    const run = sampleFile().proposals.find((p) => p.id === 'run-club-125-plus')!;
    const ids = run.tracks.map((t) => t.id).slice(0, 5).reverse();
    patchProposal(db, 'run-club-125-plus', { status: 'approved', name: 'Tempo Run', trackIds: ids }, paths);
    patchProposal(db, 'neon-drive-80s', { status: 'approved' }, paths);
    patchProposal(db, 'sunday-jazz-funk', { status: 'dropped' }, paths);

    const wanted = ['run-club-125-plus', 'neon-drive-80s', 'sunday-jazz-funk'];
    expect(applicableIds(db, wanted, paths)).toEqual(['run-club-125-plus', 'neon-drive-80s']);

    const progress: string[] = [];
    const r = await applyProposals(db, client(), wanted, (_d, _t, m) => progress.push(m ?? ''), paths);
    expect(r.created.map((c) => c.id)).toEqual(['run-club-125-plus', 'neon-drive-80s']);
    expect(r.skipped).toEqual([{ id: 'sunday-jazz-funk', reason: 'status is dropped' }]);
    expect(progress[0]).toBe('Creating "Tempo Run"');

    const creates = calls.filter((c) => c.path === '/v1/me/playlists');
    expect(creates[0]!.body).toEqual({
      name: 'Tempo Run',
      description: 'High-energy tracks at 125 BPM or faster, from three different scenes. · by Curator for Spotify',
      public: false,
    });
    const adds = calls.filter((c) => c.path.endsWith('/items'));
    expect(adds[0]!.body.uris).toEqual(ids.map((id) => `spotify:track:${id}`));

    const state = readState(db, 'run-club-125-plus');
    expect(state.status).toBe('created');
    expect(state.spotifyPlaylistId).toBe(r.created[0]!.spotifyPlaylistId);
    expect(applySummary(r)).toBe('Created 2 playlists. Skipped 1.');
  });

  it('skips proposals that were already created, so a retry makes no duplicates', async () => {
    patchProposal(db, 'neon-drive-80s', { status: 'approved' }, paths);
    await applyProposals(db, client(), ['neon-drive-80s'], undefined, paths);
    calls = [];
    const r = await applyProposals(db, client(), ['neon-drive-80s'], undefined, paths);
    expect(calls).toEqual([]);
    expect(r.skipped).toEqual([{ id: 'neon-drive-80s', reason: 'already created' }]);
    expect(() => patchProposal(db, 'neon-drive-80s', { status: 'pending' }, paths)).toThrow(/already on Spotify/);
  });

  it('keeps going after one failure and leaves the failed one approved', async () => {
    patchProposal(db, 'neon-drive-80s', { status: 'approved' }, paths);
    patchProposal(db, 'golden-era-boom-bap', { status: 'approved' }, paths);
    failOnName = 'Neon Drive';
    const r = await applyProposals(db, client(), ['neon-drive-80s', 'golden-era-boom-bap'], undefined, paths);
    expect(r.failed.map((f) => f.id)).toEqual(['neon-drive-80s']);
    expect(r.created.map((c) => c.id)).toEqual(['golden-era-boom-bap']);
    expect(readState(db, 'neon-drive-80s').status).toBe('approved');
    expect(applySummary(r)).toMatch(/Failed: "Neon Drive" \(Spotify 400/);
  });

  it('skips unknown track ids when creating', async () => {
    const f = sampleFile();
    f.proposals[0]!.tracks.unshift({ id: 'abcdefghijklmnopqrstuv' });
    writeFileSync(paths.proposals, JSON.stringify(f));
    patchProposal(db, f.proposals[0]!.id, { status: 'approved' }, paths);
    await applyProposals(db, client(), [f.proposals[0]!.id], undefined, paths);
    const uris = calls.find((c) => c.path.endsWith('/items'))!.body.uris as string[];
    expect(uris).toHaveLength(f.proposals[0]!.tracks.length - 1);
    expect(uris).not.toContain('spotify:track:abcdefghijklmnopqrstuv');
  });
});
