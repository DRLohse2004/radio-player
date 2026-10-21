import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // relative Pfade, damit Electron die gebaute index.html per file:// laden kann
  base: './',
})
