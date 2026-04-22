import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // base: '/' for Netlify/custom domain, '/MerQuant/' for GitHub Pages
  // GitHub Actions sets this via VITE_BASE_URL env var
  base: process.env.VITE_BASE_URL || '/',
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
