import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// WEB_PORT and PORT (the API server) let a second copy run next to the first,
// e.g. `PORT=8797 WEB_PORT=5183 npm run demo`.
const webPort = Number(process.env.WEB_PORT ?? 5173);
const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

// Spotify rejects "localhost" redirect URIs, so everything runs on 127.0.0.1.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': api,
      '/auth': api,
    },
  },
});
