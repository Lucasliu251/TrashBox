/** Browser clients share the server's HttpOnly session cookie. */
export interface AuthProvider {
  id: string
  label: string
  enabled: boolean
  disabled_reason?: string
}

export interface AuthIdentity {
  provider: string
  subject: string
  label: string | null
}

export interface AuthSession {
  authenticated: true
  csrf_token: string
  user: {
    id: string
    display_name: string | null
    avatar_url: string | null
    steam_id: string | null
    legacy_uuid: string | null
  }
  identities: AuthIdentity[]
  providers: AuthProvider[]
  session: {
    id: string
    idle_expires_at: string
    absolute_expires_at: string
  }
}

export class AuthRequestError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const API_BASE = (import.meta.env.VITE_API_BASE || window.location.origin).replace(/\/$/, '')
let csrfToken = ''

export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback
  try {
    const parsed = new URL(value, window.location.origin)
    if (parsed.origin !== window.location.origin) return fallback
    if (/^\/(?:login|auth)(?:\/|$)/.test(parsed.pathname)) return fallback
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch { return fallback }
}

export function currentReturnTo(): string {
  return safeReturnTo(`${location.pathname}${location.search}${location.hash}`)
}

export function loginUrl(returnTo = currentReturnTo()): string {
  return `/login?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`
}

export function accountUrl(returnTo = currentReturnTo()): string {
  return `/account?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`
}

export function redirectToLogin(returnTo = currentReturnTo()) {
  window.location.replace(loginUrl(returnTo))
}

export function providerUrl(provider: string, mode: 'login' | 'link' | 'reauth', returnTo: string): string {
  return `${API_BASE}/api/v1/auth/${mode}/${encodeURIComponent(provider)}?return_to=${encodeURIComponent(safeReturnTo(returnTo))}`
}

export async function authRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const method = (init.method || 'GET').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    if (csrfToken) headers.set('X-Trashbox-CSRF', csrfToken)
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: 'include', headers })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = body?.detail || body?.message
    const message = response.status === 401 ? '登录已过期，请重新登录'
      : response.status === 502 || response.status === 503 ? '服务暂不可用，请稍后重试'
      : typeof detail === 'string' ? detail : `请求失败 (${response.status})`
    throw new AuthRequestError(response.status, message)
  }
  if (body?.code && !(body.code >= 200 && body.code < 300)) throw new AuthRequestError(response.status, body.message || '请求失败')
  return (body && Object.hasOwn(body, 'data') ? body.data : body) as T
}

export async function getAuthSession(): Promise<AuthSession | null> {
  try {
    const session = await authRequest<AuthSession>('/api/v1/auth/session')
    if (!session?.authenticated) { csrfToken = ''; return null }
    csrfToken = session.csrf_token
    return session
  } catch (error) {
    if (error instanceof AuthRequestError && error.status === 401) {
      csrfToken = ''
      return null
    }
    throw error
  }
}

/** Only real foreground input extends the idle deadline; background polling does not. */
export function startSessionActivity(onExpired: () => void): () => void {
  let lastActivityRequest = 0
  let checking = false
  let lastCheck = 0
  const onInput = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== 'visible' || !document.hasFocus()) return
    const now = Date.now()
    if (now - lastActivityRequest < 60_000) return
    lastActivityRequest = now
    void authRequest('/api/v1/auth/activity', { method: 'POST' }).catch(error => {
      if (error instanceof AuthRequestError && error.status === 401) onExpired()
    })
  }
  const onVisible = async () => {
    if (document.visibilityState !== 'visible' || checking || Date.now() - lastCheck < 5_000) return
    checking = true
    lastCheck = Date.now()
    try {
      if (!await getAuthSession()) onExpired()
    } catch { /* A transient network error does not sign the user out. */ }
    finally { checking = false }
  }
  window.addEventListener('pointerdown', onInput, { passive: true })
  window.addEventListener('keydown', onInput)
  window.addEventListener('focus', onVisible)
  document.addEventListener('visibilitychange', onVisible)
  const expiryCheck = window.setInterval(onVisible, 60_000)
  return () => {
    window.removeEventListener('pointerdown', onInput)
    window.removeEventListener('keydown', onInput)
    window.removeEventListener('focus', onVisible)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(expiryCheck)
  }
}
