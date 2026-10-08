import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 将 BASE_PATH 转成 Vite `base`（必须以 / 开头和结尾）。
 * 生产构建须与 Nginx location、serve.sh 中的 RADAR_BASE_PATH 一致，例如 `/radar/`。
 * @param raw - 原始路径前缀
 * @returns Vite public base
 */
function viteBasePath(raw: string | undefined): string {
  if (!raw) return '/'
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.split('/').filter(Boolean).join('/')}/`
}

export default defineConfig({
  base: viteBasePath(process.env.BASE_PATH),
  plugins: [vue()],
  server: {
    port: Number(process.env.LOCAL_RADAR_PORT || 5173),
    proxy: {
      '/api/': `http://127.0.0.1:${process.env.LOCAL_API_PORT || '2026'}`,
      '/login': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
      '/account': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
      '/auth/': `http://127.0.0.1:${process.env.LOCAL_AUTH_PORT || '5175'}`,
    },
  },
})
