import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        serviceWorker: resolve(__dirname, 'src/serviceWorker.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'serviceWorker') {
            return 'assets/[name].js';
          }
          if (chunkInfo.name.includes('pdf.worker')) {
            return 'assets/pdf.worker.mjs';
          }
          return 'assets/[name]-[hash].js';
        },
        assetFileNames: (assetInfo) => {
          const assetName = assetInfo.name ?? '';
          if (assetName.includes('pdf.worker')) {
            return 'assets/pdf.worker.mjs';
          }
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
