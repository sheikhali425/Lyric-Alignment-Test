import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // WEB_PORT lets this run alongside something else already on 5173.
    port: Number(process.env.WEB_PORT ?? 5173),
    strictPort: true,
    // Everything under /api goes to the backend, including the audio asset,
    // so the browser only ever talks to one origin.
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
