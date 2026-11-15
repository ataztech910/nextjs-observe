import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  plugins:[react(),tailwind()],
  resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
  base:'./',
  define:{'process.env.NODE_ENV':JSON.stringify('production')},
  build:{lib:{entry:'src/main.tsx',name:'PerformanceDeck',formats:['iife'],fileName:()=> 'engine.js',cssFileName:'engine'}},
});
