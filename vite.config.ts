import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { resolveSpotifyFromUrl } from './src/lib/spotifyResolve';

function spotifyResolveDevApi(): Plugin {
  return {
    name: 'spotify-resolve-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        if (!url.startsWith('/api/spotify-resolve')) return next();

        res.setHeader('Access-Control-Allow-Origin', '*');
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
          res.end();
          return;
        }

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          const raw = url.includes('?') ? url.split('?')[1] : '';
          const params = new URLSearchParams(raw);
          const spotifyUrl = String(params.get('url') || '').trim();
          const payload = await resolveSpotifyFromUrl(spotifyUrl);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        } catch (e: any) {
          const message = typeof e?.message === 'string' ? e.message : 'unknown error';
          const missingCreds = message.includes('Missing SPOTIFY_CLIENT_ID');
          const badRequest = Number(e?.statusCode) === 400 || message.includes('Invalid spotify url');
          res.statusCode = badRequest ? 400 : missingCreds ? 501 : 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  process.env.SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || env.SPOTIFY_CLIENT_ID;
  process.env.SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET || env.SPOTIFY_CLIENT_SECRET;

  return {
    plugins: [react(), tailwindcss(), spotifyResolveDevApi()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        'node-fetch': path.resolve(__dirname, 'src/empty.js'),
        'formdata-polyfill': path.resolve(__dirname, 'src/empty.js'),
        'formdata-polyfill/esm.min.js': path.resolve(__dirname, 'src/empty.js'),
      },
    },
    optimizeDeps: {
      exclude: ['@google/genai', 'node-fetch', 'formdata-polyfill'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});