import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  build: { assetsDir: 'site-static' },
  server: {
    port: 5174,
    proxy: {
      '/api/': 'http://127.0.0.1:2026',
    },
  },
})
