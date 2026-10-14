import Database from 'better-sqlite3';
import { Hono, type Context } from 'hono';
import { ImportRequestSchema, fullBackupFileName, parseFullBackup, type FullBackup } from '@curator/shared';
import { DATA_DIR, getDb, type DB } from '../../db/db.ts';
import { FullBackupError, applyImport, exportFullBackup, previewImport } from './service.ts';

export interface BackupRouteDeps {
  db: () => DB;
  dataDir: () => string;
}

async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new FullBackupError(400, 'The file is not valid JSON.');
  }
}

function parseBackup(input: unknown): FullBackup {
  const parsed = parseFullBackup(input);
  if (!parsed.ok) throw new FullBackupError(400, parsed.error);
  return parsed.backup;
}

// Mounted at /api/backup. A Full Backup holds the user's work and, optionally, the library cache.
export const makeBackupRoutes = (deps: BackupRouteDeps = { db: getDb, dataDir: () => DATA_DIR }) =>
  new Hono()
    .onError((err, c) => {
      if (err instanceof FullBackupError) return c.json({ error: err.message }, err.status);
      // An SQLite error here comes from broken file content; the transaction rolled back.
      if (err instanceof Database.SqliteError)
        return c.json({ error: `The Full Backup could not be imported, nothing was changed: ${err.message}` }, 400);
      throw err;
    })
    .get('/export', (c) => {
      const backup = exportFullBackup(deps.db(), { includeLibrary: c.req.query('library') === '1', dataDir: deps.dataDir() });
      return c.body(JSON.stringify(backup), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fullBackupFileName(backup.exportedAt)}"`,
        'Cache-Control': 'no-store',
      });
    })
    .post('/import/preview', async (c) => {
      const backup = parseBackup(await readJson(c));
      return c.json(previewImport(deps.db(), backup, { dataDir: deps.dataDir() }));
    })
    .post('/import', async (c) => {
      const body = ImportRequestSchema.safeParse(await readJson(c));
      if (!body.success) throw new FullBackupError(400, 'Send { backup, choices, defaultChoice, importLibrary }.');
      const { backup, ...opts } = body.data;
      return c.json(applyImport(deps.db(), parseBackup(backup), { ...opts, dataDir: deps.dataDir() }));
    });

export const backupRoutes = makeBackupRoutes();
