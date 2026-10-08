import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/',
  cacheDir: '../.run-local/ow-vite-cache',
  plugins: [vue()],
  build: { assetsDir: 'site-static' },
  server: {
    port: 5174,
    proxy: {
      '/api/': 'http://127.0.0.1:2026',
      '/ow-live': {
        target: 'https://webapi.blizzard.cn',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ow-live/, '/ow-armory-server'),
        configure(proxy) {
          proxy.on('proxyReq', request => {
            request.removeHeader('origin')
            request.removeHeader('referer')
          })
        },
      },
    },
  },
})
