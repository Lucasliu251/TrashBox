import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  build: { assetsDir: 'site-static' },
  server: {
    port: Number(process.env.LOCAL_SITE_PORT || 5174),
    proxy: {
      '/api/': `http://127.0.0.1:${process.env.LOCAL_API_PORT || '2026'}`,
      '/login': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
      '/account': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
      '/auth/': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
    },
  },
})
