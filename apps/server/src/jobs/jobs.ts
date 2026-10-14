import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Job, JobKind } from '@curator/shared';
import { getDb, nowIso, type DB } from '../db/db.ts';

export interface JobContext {
  jobId: string;
  /** Report progress. Cheap to call often; writes are throttled. */
  progress(done: number, total: number, message?: string): void;
  /** Aborted when the user presses Stop. Long jobs check it between steps. */
  signal: AbortSignal;
}

// Abort handles of running jobs in this process.
const controllers = new Map<string, AbortController>();

/** Asks a running job to stop. It finishes its current step, then ends as 'done'. */
export function cancelJob(id: string): boolean {
  const controller = controllers.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}

interface JobRow {
  id: string;
  kind: JobKind;
  status: Job['status'];
  progress: number;
  total: number;
  message: string;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

const toJob = (r: JobRow): Job => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  progress: r.progress,
  total: r.total,
  message: r.message,
  error: r.error,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
});

export function getJob(id: string, db: DB = getDb()): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function latestJob(kind: JobKind, db: DB = getDb()): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE kind = ? ORDER BY started_at DESC LIMIT 1').get(kind) as
    | JobRow
    | undefined;
  return row ? toJob(row) : null;
}

export function recentJobs(kind: JobKind, limit: number, db: DB = getDb()): Job[] {
  const rows = db.prepare('SELECT * FROM jobs WHERE kind = ? ORDER BY started_at DESC LIMIT ?').all(kind, limit) as JobRow[];
  return rows.map(toJob);
}

/**
 * Starts a background job and returns its id at once. Only one job of a kind
 * runs at a time; starting a second returns the running one.
 */
export function startJob(kind: JobKind, fn: (ctx: JobContext) => Promise<string | void>, db: DB = getDb()): Job {
  const running = db.prepare("SELECT * FROM jobs WHERE kind = ? AND status = 'running'").get(kind) as JobRow | undefined;
  if (running) return toJob(running);

  const id = randomUUID();
  db.prepare("INSERT INTO jobs (id, kind, status, started_at) VALUES (?, ?, 'running', ?)").run(id, kind, nowIso());
  let lastWrite = 0;
  const update = db.prepare('UPDATE jobs SET progress = ?, total = ?, message = ? WHERE id = ?');
  const controller = new AbortController();
  controllers.set(id, controller);
  const ctx: JobContext = {
    jobId: id,
    signal: controller.signal,
    progress(done, total, message = '') {
      const now = Date.now();
      if (now - lastWrite < 250 && done < total) return;
      lastWrite = now;
      update.run(done, total, message, id);
    },
  };

  void (async () => {
    try {
      const message = await fn(ctx);
      db.prepare("UPDATE jobs SET status = 'done', finished_at = ?, message = COALESCE(?, message) WHERE id = ?").run(
        nowIso(),
        message ?? null,
        id,
      );
    } catch (err) {
      console.error(`[job ${kind}]`, err);
      db.prepare("UPDATE jobs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?").run(
        nowIso(),
        err instanceof Error ? err.message : String(err),
        id,
      );
    } finally {
      controllers.delete(id);
    }
  })();

  return getJob(id, db)!;
}

/** Marks jobs left 'running' by a previous process as failed. */
export function failStaleJobs(db: DB = getDb()) {
  db.prepare("UPDATE jobs SET status = 'failed', error = 'Interrupted: the server restarted. Run it again to continue where it stopped.', finished_at = ? WHERE status = 'running'").run(
    nowIso(),
  );
}

export const jobRoutes = new Hono()
  .post('/:id/cancel', (c) => c.json({ ok: cancelJob(c.req.param('id')) }))
  .get('/:id', (c) => {
    const job = getJob(c.req.param('id'));
    return job ? c.json(job) : c.json({ error: 'not found' }, 404);
  })
  .get('/', (c) => {
    const kind = c.req.query('kind') as JobKind | undefined;
    return c.json(kind ? latestJob(kind) : null);
  })
  .get('/history/:kind', (c) => c.json(recentJobs(c.req.param('kind') as JobKind, 8)));
