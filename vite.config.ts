import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  build: {
    outDir: '../dist/public',
    emptyOutDir: true,
  },
  server: {
    // In dev the backend runs separately on :8080 (npm run dev starts both).
    proxy: {
      '/socket.io': {
        target: 'http://localhost:8080',
        ws: true,
      },
    },
  },
});
