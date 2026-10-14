import { Hono } from 'hono';
import { authRoutes, NotConnectedError } from './spotify/auth.ts';
import { SpotifyApiError } from './spotify/client.ts';
import { jobRoutes } from './jobs/jobs.ts';
import { syncRoutes } from './features/sync/routes.ts';
import { enrichRoutes } from './features/enrich/routes.ts';
import { pruneRoutes } from './features/prune/routes.ts';
import { djRoutes } from './features/dj/routes.ts';
import { proposalsRoutes } from './features/proposals/routes.ts';
import { backupRoutes } from './features/backup/routes.ts';

export const app = new Hono()
  .route('/auth', authRoutes)
  .route('/api/jobs', jobRoutes)
  .route('/api/sync', syncRoutes)
  .route('/api/enrich', enrichRoutes)
  .route('/api/prune', pruneRoutes)
  .route('/api/dj', djRoutes)
  .route('/api/proposals', proposalsRoutes)
  .route('/api/backup', backupRoutes)
  .get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  if (err instanceof NotConnectedError) return c.json({ error: err.message, code: 'not_connected' }, 401);
  if (err instanceof SpotifyApiError) return c.json({ error: err.message, code: 'spotify' }, 502);
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export type AppType = typeof app;
