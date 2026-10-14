const port = Number(process.env.PORT ?? 8787);
const webPort = Number(process.env.WEB_PORT ?? 5173);

export const config = {
  clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
  redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? `http://127.0.0.1:${port}/auth/callback`,
  webOrigin: process.env.WEB_ORIGIN ?? `http://127.0.0.1:${webPort}`,
  port,
  webPort,
  /** Demo mode: fake Library from CURATOR_DATA_DIR, no Spotify calls (see src/demo). */
  demo: process.env.CURATOR_DEMO === '1',
};
