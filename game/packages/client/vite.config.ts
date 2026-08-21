import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 将 BASE_PATH 转成 Vite `base`（必须以 / 开头和结尾）。
 * 构建生产包时需与运行时环境变量、Nginx location 保持一致，例如 `/trashbox/game/sniper/`。
 * @param raw - 原始路径前缀
 * @returns Vite public base
 */
function viteBasePath(raw: string | undefined): string {
  if (!raw) return '/'
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.split('/').filter(Boolean).join('/')}/`
}

const base = viteBasePath(process.env.BASE_PATH)
const prefix = base.replace(/\/$/, '') || ''

export default defineConfig({
  base,
  plugins: [vue()],
  server: {
    proxy: {
      [`${prefix}/ws`]: { target: 'ws://127.0.0.1:8080', ws: true },
      [`${prefix}/healthz`]: { target: 'http://127.0.0.1:8080' },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'three-bvh': ['three-mesh-bvh'],
        },
      },
    },
  },
})
