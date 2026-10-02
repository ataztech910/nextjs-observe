import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Built into the package's dist/ui; the collector serves it at / next to its /api.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  build: { outDir: '../dist/ui', emptyOutDir: true },
  // `npm run dev` here talks to a collector started with `next-observer dev` / `next-observer collector`.
  server: { proxy: { '/api': 'http://127.0.0.1:4318' } },
})
