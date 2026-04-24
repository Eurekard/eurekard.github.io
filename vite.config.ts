import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
    host: true,
    port: 3000,
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});