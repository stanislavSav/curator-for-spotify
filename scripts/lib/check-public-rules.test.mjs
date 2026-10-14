// Run: node --test scripts/lib/
// Test inputs are built at run time, so this file does not trip the guard itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPath, isBinary, mask, parseMarkers, scanText } from './check-public-rules.mjs';

const hex32 = '0123456789abcdef'.repeat(2);
const token = 'BQ' + 'Ab9_-'.repeat(24);
const keyHeader = '-----BEGIN ' + 'PRIVATE KEY-----';

test('blocks private paths', () => {
  for (const p of [
    'data/curator.sqlite',
    'data/demo/snapshot.json',
    'data/backups/2026-10-14.json',
    'old/curator.sqlite-wal',
    'x/library.db',
    'snapshot.json',
    'apps/server/proposals.json',
    'proposals.old.json',
    'backups/prune-1.json',
    '.env',
    'apps/server/.env.local',
    'certs/server.pem',
    'id.key',
    'Streaming_History_Audio_2020-2021_0.json',
    'my_spotify_data.zip',
    '.private-markers',
  ]) {
    assert.ok(checkPath(p), `expected ${p} to be blocked`);
  }
});

test('allows normal and intentional paths', () => {
  for (const p of [
    'data/.gitkeep',
    '.env.example',
    '.private-markers.example',
    'apps/server/src/features/proposals/fixtures/proposals.sample.json',
    'apps/server/src/features/proposals/fixtures/library.sample.json',
    'apps/server/src/features/enrich/snapshot.ts',
    'packages/shared/src/proposals.ts',
    'docs/adr/0001-claude-writes-proposals-offline.md',
    'package.json',
    'keyboard.ts',
  ]) {
    assert.equal(checkPath(p), null, `expected ${p} to be allowed`);
  }
});

test('finds a Client ID in an env-style line', () => {
  assert.equal(scanText(`SPOTIFY_CLIENT_ID=${hex32}`).length, 1);
  assert.equal(scanText(`  client_id: "${hex32}"`).length, 1);
  assert.equal(scanText('SPOTIFY_CLIENT_ID=').length, 0);
  assert.equal(scanText(`commit ${hex32}`).length, 0);
});

test('finds private keys and Spotify access tokens', () => {
  assert.equal(scanText(`x\n${keyHeader}\ny`)[0].line, 2);
  assert.equal(scanText('-----BEGIN RSA ' + 'PRIVATE KEY-----').length, 1);
  assert.equal(scanText(`Authorization: Bearer ${token}`).length, 1);
  assert.equal(scanText('BQ' + 'a'.repeat(50)).length, 0);
});

test('finds generic secrets, but not code or placeholders', () => {
  assert.equal(scanText(`API_KEY=${'k3y'.repeat(10)}`).length, 1);
  assert.equal(scanText(`const clientSecret = "${'s3cr'.repeat(6)}";`).length, 1);
  assert.equal(scanText('refresh_token: tokens.refresh_token,').length, 0);
  assert.equal(scanText("access_token: 'fake-access-token-1234567'").length, 0);
  assert.equal(scanText('API_KEY=${API_KEY_FROM_ENVIRONMENT_1}').length, 0);
  assert.equal(scanText('token: "short1"').length, 0);
});

test('secrets are masked in findings', () => {
  const [f] = scanText(`API_KEY=${'k3y'.repeat(10)}`);
  assert.ok(!f.detail.includes('k3yk3yk3y'));
  assert.equal(mask('abc'), '****');
});

test('the ignore marker skips a line', () => {
  assert.equal(scanText(`SPOTIFY_CLIENT_ID=${hex32} # check-public-ignore`).length, 0);
});

test('personal markers: literals are case-insensitive, regex lines work, comments are skipped', () => {
  const markers = parseMarkers('# my markers\n\nJane Example\n/\\b12,?345\\b/\n/road trip/i\n');
  assert.equal(markers.length, 3);
  assert.equal(scanText('by jane EXAMPLE', markers).length, 1);
  assert.equal(scanText('a 12,345-track library', markers).length, 1);
  assert.equal(scanText('a 12345 track library', markers).length, 1);
  assert.equal(scanText('id 132456', markers).length, 0);
  assert.equal(scanText('Road Trip 2019', markers)[0].detail, '/road trip/i');
});

test('a path-like marker is a literal, not a regex', () => {
  const markers = parseMarkers('/Users/jane\n');
  assert.equal(scanText('cd /Users/jane/code', markers).length, 1);
  assert.equal(scanText('cd /Users/john/code', markers).length, 0);
});

test('detects binary buffers', () => {
  assert.equal(isBinary(Buffer.from([0x89, 0x50, 0x00, 0x47])), true);
  assert.equal(isBinary(Buffer.from('plain text')), false);
});
