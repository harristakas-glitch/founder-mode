import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  // Relative asset paths so the built game runs straight from dist/index.html (file://)
  base: './',
  plugins: [react(), tailwindcss()],
})
