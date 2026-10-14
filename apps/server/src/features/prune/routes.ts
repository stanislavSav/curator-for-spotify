import { Hono } from 'hono';
import {
  PruneRequestSchema,
  type HistoryImportResponse,
  type HistoryImportResult,
  type PruneResult,
} from '@curator/shared';
import { getDb } from '../../db/db.ts';
import { getJob, startJob } from '../../jobs/jobs.ts';
import { spotify } from '../../spotify/client.ts';
import { getCandidates, parseMonths } from './candidates.ts';
import { historySummary, importHistory, JOB_THRESHOLD_BYTES, type UploadedFile } from './history.ts';
import { listBackups, restoreBackup, RestoreError, runPrune } from './prune.ts';

// Job results live in memory: they are only needed while the page watches the job.
const importResults = new Map<string, HistoryImportResult>();
const pruneResults = new Map<string, PruneResult[]>();

const importMessage = (r: HistoryImportResult) =>
  `Imported ${r.inserted} new plays (${r.duplicates} already there, ${r.skipped} skipped).`;

// Owned by the prune feature. Mounted at /api/prune.
export const pruneRoutes = new Hono()
  .post('/history', async (c) => {
    const form = await c.req.formData().catch(() => null);
    if (!form) return c.json({ error: 'Send the files as multipart/form-data.' }, 400);
    const uploads: UploadedFile[] = [];
    for (const value of form.values()) {
      if (typeof value === 'string') continue;
      uploads.push({ name: value.name, data: new Uint8Array(await value.arrayBuffer()) });
    }
    if (uploads.length === 0) return c.json({ error: 'No files received.' }, 400);

    const db = getDb();
    const bytes = uploads.reduce((n, f) => n + f.data.byteLength, 0);
    // A zip expands to roughly 8× its size; treat it as large earlier.
    const large = uploads.some((f) => /\.zip$/i.test(f.name)) ? bytes * 8 > JOB_THRESHOLD_BYTES : bytes > JOB_THRESHOLD_BYTES;
    if (!large) {
      try {
        return c.json({ result: await importHistory(db, uploads) } satisfies HistoryImportResponse);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
      }
    }
    const job = startJob('history-import', async (ctx) => {
      ctx.progress(0, 1, 'Reading files…');
      const result = await importHistory(db, uploads, {
        onProgress: async (done, total) => {
          ctx.progress(done, total, 'Saving plays…');
          await new Promise((r) => setImmediate(r));
        },
      });
      importResults.set(ctx.jobId, result);
      return importMessage(result);
    });
    return c.json({ job } satisfies HistoryImportResponse);
  })
  .get('/history/summary', (c) => c.json(historySummary(getDb())))
  .get('/history/import/:jobId', (c) => {
    const result = importResults.get(c.req.param('jobId'));
    return result ? c.json(result) : c.json({ error: 'No result for this job.' }, 404);
  })
  .get('/candidates', (c) => c.json(getCandidates(getDb(), parseMonths(c.req.query('months')))))
  .post('/', async (c) => {
    const parsed = PruneRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Send { playlistIds: string[] }.' }, 400);
    const db = getDb();
    const job = startJob('prune', async (ctx) => {
      const results = await runPrune(db, spotify(), parsed.data.playlistIds, {
        onProgress: (done, total, list) => {
          pruneResults.set(ctx.jobId, list);
          ctx.progress(done, total, done < total ? `Pruning ${list[done]?.name ?? ''}…` : 'Finishing…');
        },
      });
      const failed = results.filter((r) => r.status === 'failed').length;
      return `Pruned ${results.length - failed} of ${results.length} playlists${failed ? `, ${failed} failed` : ''}.`;
    }, db);
    return c.json({ job });
  })
  .get('/results/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    if (!getJob(jobId)) return c.json({ error: 'Job not found.' }, 404);
    return c.json({ jobId, results: pruneResults.get(jobId) ?? [] });
  })
  .get('/backups', (c) => c.json(listBackups(getDb())))
  .post('/restore/:backupId', async (c) => {
    const id = Number(c.req.param('backupId'));
    if (!Number.isInteger(id)) return c.json({ error: 'Bad backup id.' }, 400);
    try {
      return c.json(await restoreBackup(getDb(), spotify(), id));
    } catch (err) {
      if (err instanceof RestoreError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  });
