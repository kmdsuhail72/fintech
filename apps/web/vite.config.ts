import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: {
    port: 5173,
    strictPort: true,
    watch: { usePolling: process.env.CHOKIDAR_USEPOLLING === 'true' },
    ...(process.env.API_PROXY_TARGET
      ? {
          proxy: {
            '/api': {
              target: process.env.API_PROXY_TARGET,
              changeOrigin: true,
              timeout: 190_000,
              proxyTimeout: 190_000,
            },
            '/socket.io': { target: process.env.API_PROXY_TARGET, ws: true, changeOrigin: true },
          },
        }
      : {}),
  },
});
