import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base = имя репозитория на GitHub Pages: https://<user>.github.io/max-apocalypse/
export default defineConfig({
  base: '/max-apocalypse/',
  plugins: [react()],
})
