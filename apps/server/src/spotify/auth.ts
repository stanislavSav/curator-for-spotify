import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import type { AuthStatus } from '@curator/shared';
import { getDb, nowIso, type DB } from '../db/db.ts';
import { config } from '../config.ts';

export const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'user-follow-modify',
  'user-top-read',
  'user-read-recently-played',
];

const ACCOUNTS = 'https://accounts.spotify.com';
const REFRESH_TOKEN_LIFETIME_MS = 182 * 24 * 3600 * 1000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
}

interface AuthRow {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string;
  user_id: string | null;
  display_name: string | null;
  authorized_at: string;
}

export class NotConnectedError extends Error {
  constructor(message = 'Not connected to Spotify. Open the app and log in.') {
    super(message);
  }
}

const b64url = (buf: Buffer) => buf.toString('base64url');

// PKCE verifiers keyed by state. One user, short-lived: memory is enough.
const pending = new Map<string, { verifier: string; createdAt: number }>();

export function readAuth(db: DB = getDb()): AuthRow | undefined {
  return db.prepare('SELECT * FROM auth WHERE id = 1').get() as AuthRow | undefined;
}

function saveTokens(db: DB, t: TokenResponse, authorizedAt?: string) {
  const prev = readAuth(db);
  db.prepare(
    `INSERT INTO auth (id, access_token, refresh_token, expires_at, scope, user_id, display_name, authorized_at)
     VALUES (1, @access_token, @refresh_token, @expires_at, @scope, @user_id, @display_name, @authorized_at)
     ON CONFLICT(id) DO UPDATE SET access_token = excluded.access_token, refresh_token = excluded.refresh_token,
       expires_at = excluded.expires_at, scope = excluded.scope, authorized_at = excluded.authorized_at`,
  ).run({
    access_token: t.access_token,
    // Spotify may rotate the refresh token; keep the old one when it doesn't.
    refresh_token: t.refresh_token ?? prev?.refresh_token ?? '',
    expires_at: Date.now() + (t.expires_in - 60) * 1000,
    scope: t.scope,
    user_id: prev?.user_id ?? null,
    display_name: prev?.display_name ?? null,
    authorized_at: authorizedAt ?? prev?.authorized_at ?? nowIso(),
  });
}

async function tokenRequest(body: Record<string, string>, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const res = await fetchImpl(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, ...body }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (text.includes('invalid_grant')) throw new NotConnectedError('Spotify login expired. Log in again.');
    throw new Error(`Spotify token request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Returns a valid access token, refreshing it when needed. */
export async function getAccessToken(db: DB = getDb(), fetchImpl: typeof fetch = fetch): Promise<string> {
  const row = readAuth(db);
  if (!row) throw new NotConnectedError();
  if (row.expires_at > Date.now()) return row.access_token;
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: row.refresh_token }, fetchImpl);
    saveTokens(db, t);
    return t.access_token;
  } catch (err) {
    if (err instanceof NotConnectedError) db.prepare('DELETE FROM auth').run();
    throw err;
  }
}

export function authStatus(db: DB = getDb()): AuthStatus {
  if (config.demo) return demoAuthStatus();
  const row = readAuth(db);
  return {
    configured: Boolean(config.clientId),
    connected: Boolean(row),
    user: row?.user_id ? { id: row.user_id, displayName: row.display_name ?? row.user_id } : null,
    reloginBy: row ? new Date(Date.parse(row.authorized_at) + REFRESH_TOKEN_LIFETIME_MS).toISOString() : null,
    redirectUri: config.redirectUri,
  };
}

/** Demo mode always looks connected; nothing is ever sent to Spotify (see src/demo). */
function demoAuthStatus(): AuthStatus {
  return {
    configured: true,
    connected: true,
    user: { id: 'demo', displayName: 'Demo listener' },
    reloginBy: new Date(Date.now() + 140 * 24 * 3600 * 1000).toISOString(),
    redirectUri: config.redirectUri,
  };
}

export const authRoutes = new Hono()
  .get('/login', (c) => {
    // Relative, so the browser stays on the web app's origin (behind the Vite proxy).
    if (config.demo) return c.redirect('/');
    if (!config.clientId) return c.text('SPOTIFY_CLIENT_ID is missing in .env', 500);
    const verifier = b64url(randomBytes(64));
    const state = b64url(randomBytes(16));
    pending.set(state, { verifier, createdAt: Date.now() });
    const url = new URL(`${ACCOUNTS}/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      scope: SCOPES.join(' '),
      redirect_uri: config.redirectUri,
      state,
      code_challenge_method: 'S256',
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
    }).toString();
    return c.redirect(url.toString());
  })
  .get('/callback', async (c) => {
    if (config.demo) return c.redirect('/');
    const { code, state, error } = c.req.query();
    const entry = state ? pending.get(state) : undefined;
    if (state) pending.delete(state);
    if (error || !code || !entry) {
      return c.redirect(`${config.webOrigin}/?authError=${encodeURIComponent(error ?? 'invalid_state')}`);
    }
    const db = getDb();
    const tokens = await tokenRequest(
      { grant_type: 'authorization_code', code, redirect_uri: config.redirectUri, code_verifier: entry.verifier },
      fetch,
    );
    saveTokens(db, tokens, nowIso());
    const me = (await fetch('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    }).then((r) => r.json())) as { id: string; display_name?: string };
    db.prepare('UPDATE auth SET user_id = ?, display_name = ? WHERE id = 1').run(me.id, me.display_name ?? me.id);
    return c.redirect(`${config.webOrigin}/`);
  })
  .get('/status', (c) => c.json(authStatus()))
  .post('/logout', (c) => {
    getDb().prepare('DELETE FROM auth').run();
    return c.json({ ok: true });
  });
