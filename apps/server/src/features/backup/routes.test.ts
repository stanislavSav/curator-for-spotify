import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackup, ImportPreview, ImportResult } from '@curator/shared';
import { openDb } from '../../db/db.ts';
import { makeBackupRoutes } from './routes.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'curator-full-backup-routes-'));
  dirs.push(dir);
  return { db, routes: makeBackupRoutes({ db: () => db, dataDir: () => dir }) };
}

const post = (body: string) => ({ method: 'POST', body, headers: { 'Content-Type': 'application/json' } });

describe('backup routes', () => {
  it('exports a dated attachment and imports it back', async () => {
    const { db, routes } = setup();
    db.prepare("INSERT INTO dj_templates VALUES ('t', 'Sunday', 0, '{}', '2026-10-01', '2026-10-01')").run();
    db.prepare("INSERT INTO tracks (id, uri, name, duration_ms) VALUES ('t1', 'spotify:track:t1', 'Get Lucky', 248000)").run();

    const res = await routes.request('/export?library=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toMatch(/attachment; filename="curator-for-spotify-backup-\d{4}-\d{2}-\d{2}\.json"/);
    const backup = (await res.json()) as FullBackup;
    expect(backup.library?.tracks?.rows).toHaveLength(1);
    expect(((await (await routes.request('/export')).json()) as FullBackup).library).toBeNull();

    const other = setup();
    const preview = (await (await other.routes.request('/import/preview', post(JSON.stringify(backup)))).json()) as ImportPreview;
    expect(preview.summary.djTemplates.new).toBe(1);
    const result = (await (
      await other.routes.request('/import', post(JSON.stringify({ backup, choices: {}, defaultChoice: 'mine', importLibrary: true })))
    ).json()) as ImportResult;
    expect(result.counts.djTemplates.added).toBe(1);
    expect(result.library.replaced).toBe(true);
    expect(other.db.prepare('SELECT COUNT(*) AS n FROM tracks').get()).toEqual({ n: 1 });
  });

  it('rejects invalid files with 400', async () => {
    const { routes } = setup();
    const notJson = await routes.request('/import/preview', post('{oops'));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: 'The file is not valid JSON.' });
    const wrong = await routes.request('/import/preview', post(JSON.stringify({ format: 'something-else' })));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'This file is not a Curator for Spotify Full Backup.' });
    const badImport = await routes.request('/import', post(JSON.stringify({ backup: { format: 'spotify-curator-backup', version: 9 } })));
    expect(badImport.status).toBe(400);
  });
});
