// Demo mode (CURATOR_DEMO=1, see scripts/demo.mjs): a fake Library, and nothing
// ever reaches Spotify. Requests that would write to Spotify or call the network
// are answered here, before they reach a route; SpotifyClient checks again.
import { config } from '../config.ts';
import { NotConnectedError } from '../spotify/auth.ts';

export const DEMO_MESSAGE = 'Demo mode: Spotify is not connected. Nothing was changed.';

/** A NotConnectedError, so code that already handles "not connected" stays graceful. */
export class DemoModeError extends NotConnectedError {
  constructor() {
    super(DEMO_MESSAGE);
  }
}

export const isDemo = () => config.demo;

/** Throws in demo mode. Called before every Spotify API request. */
export function assertSpotifyAllowed() {
  if (isDemo()) throw new DemoModeError();
}

// Sync, Enrich (network lookups), Spotify writes, and logout. Everything else is local.
const BLOCKED: [method: string, path: RegExp][] = [
  ['POST', /^\/api\/sync\/?$/],
  ['POST', /^\/api\/enrich\/?$/],
  ['POST', /^\/api\/prune\/?$/],
  ['POST', /^\/api\/prune\/restore\/[^/]+\/?$/],
  ['POST', /^\/api\/proposals\/apply\/?$/],
  ['POST', /^\/api\/dj\/sets\/?$/],
  ['POST', /^\/api\/dj\/sets\/[^/]+\/create\/?$/],
  ['POST', /^\/auth\/logout\/?$/],
];

export function isBlockedInDemo(method: string, pathname: string): boolean {
  return BLOCKED.some(([m, re]) => m === method.toUpperCase() && re.test(pathname));
}

type FetchHandler = (req: Request, ...rest: never[]) => Response | Promise<Response>;

/**
 * Wraps the app's fetch handler. Always answers GET /api/demo, so the web app
 * knows whether to show the demo banner; in demo mode it also refuses the
 * requests above with a 403 and DEMO_MESSAGE.
 */
export function withDemoMode<F extends FetchHandler>(handler: F, demo = isDemo()): F {
  return ((req: Request, ...rest: never[]) => {
    const { pathname } = new URL(req.url);
    if (req.method === 'GET' && pathname === '/api/demo') return Response.json({ demo });
    if (demo && isBlockedInDemo(req.method, pathname)) return Response.json({ error: DEMO_MESSAGE, code: 'demo' }, { status: 403 });
    return handler(req, ...rest);
  }) as F;
}
