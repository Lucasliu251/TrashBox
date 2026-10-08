import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  base: '/auth/',
  plugins: [
    vue(),
    {
      name: 'trashbox-auth-entry-routes',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const path = request.url?.split('?')[0] || ''
          const destinations = [
            { matches: path === '/', origin: `http://127.0.0.1:${process.env.LOCAL_SITE_PORT || '5174'}` },
            { matches: /^\/radar(?:\/|$)/.test(path), origin: `http://127.0.0.1:${process.env.LOCAL_RADAR_PORT || '5173'}` },
            { matches: /^\/game\/sniper(?:\/|$)/.test(path), origin: `http://127.0.0.1:${process.env.LOCAL_SNIPER_PORT || '8003'}` },
            { matches: /^\/Music(?:\/|$)/.test(path), origin: `http://127.0.0.1:${process.env.LOCAL_MUSIC_PORT || '8004'}` },
          ]
          const destination = destinations.find(item => item.matches)
          if (destination) {
            // OAuth has one local callback port; only fixed product origins are allowed.
            _response.writeHead(302, { Location: `${destination.origin}${request.url}` })
            _response.end()
            return
          }
          // Keep /login and /account in the address bar while assets use /auth/.
          if (request.url && /^\/(?:login|account)(?:\?|\/|$)/.test(request.url)) {
            request.url = `/auth${request.url}`
          }
          next()
        })
      },
    },
  ],
  build: { assetsDir: 'auth-static' },
  server: {
    port: Number(process.env.LOCAL_AUTH_PORT || 5175),
    proxy: { '/api/': `http://127.0.0.1:${process.env.LOCAL_API_PORT || '2026'}` },
  },
})
