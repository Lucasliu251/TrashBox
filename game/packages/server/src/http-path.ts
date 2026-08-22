/**
 * @fileoverview HTTP 公共路径工具
 * @description 规范化 BASE_PATH，并在子路径反代时剥离前缀后再交给静态文件服务。
 * @author TrashBox
 * @since 2026-08-22
 */

/**
 * 将环境变量中的 BASE_PATH 规范为「空字符串或 /a/b」形式（无尾斜杠）。
 * @param raw - 原始路径，例如 `/game/sniper`、`game/sniper/` 或未设置
 * @returns 空字符串表示挂在站点根路径；否则为带前导斜杠、无尾斜杠的前缀
 */
export function normalizeBasePath(raw: string | undefined): string {
  if (!raw) return ''
  const trimmed = raw.trim()
  if (!trimmed || trimmed === '/') return ''
  return `/${trimmed.split('/').filter(Boolean).join('/')}`
}

/**
 * 取出 URL 中的 pathname（不含查询串）。
 * @param url - 原始请求 URL，可能带 query
 * @returns pathname
 */
export function requestPathname(url: string): string {
  const index = url.indexOf('?')
  return index === -1 ? url : url.slice(0, index)
}

/**
 * 判断请求是否命中健康检查。根路径 `/healthz` 始终可用，便于本机探活。
 * @param url - 原始请求 URL
 * @param basePath - 规范化后的公共前缀
 * @returns 是否为健康检查路径
 */
export function isHealthzPath(url: string, basePath: string): boolean {
  const pathname = requestPathname(url)
  return pathname === '/healthz' || Boolean(basePath) && pathname === `${basePath}/healthz`
}

/**
 * 将带公共前缀的请求路径还原为静态资源根路径，供 sirv 读取 `packages/client/dist`。
 * @param url - 原始请求 URL
 * @param basePath - 规范化后的公共前缀
 * @returns 剥离后的路径；若请求不属于该前缀则返回 null
 */
export function stripBasePath(url: string, basePath: string): string | null {
  if (!basePath) return url || '/'
  const pathname = requestPathname(url)
  const queryIndex = url.indexOf('?')
  const query = queryIndex === -1 ? '' : url.slice(queryIndex)
  if (pathname === basePath) return `/${query}`
  if (!pathname.startsWith(`${basePath}/`)) return null
  const rest = pathname.slice(basePath.length) || '/'
  return `${rest}${query}`
}
