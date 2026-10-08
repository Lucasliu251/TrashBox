import type { IncomingMessage } from 'node:http'

const SESSION_COOKIE = 'trashbox_session'

/** Only the central session cookie is forwarded; provider cookies stay on the client. */
export function sessionCookie(cookieHeader: string | undefined): string | null {
  const values = (cookieHeader || '').split(';').map(value => value.trim())
    .filter(value => value.startsWith(`${SESSION_COOKIE}=`))
  if (values.length !== 1) return null
  const value = values[0]!.slice(SESSION_COOKIE.length + 1)
  if (!value || !/^[A-Za-z0-9._~-]+$/.test(value)) return null
  return `${SESSION_COOKIE}=${value}`
}

export function centralAuthUrl(raw: string): URL {
  const url = new URL(raw)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password) {
    throw new Error('TRASHBOX_AUTH_CHECK_URL must be an HTTP loopback URL')
  }
  return url
}

/** Missing cookies, backend failure, timeout and every status except 204 deny access. */
export async function hasSession(cookieHeader: string | undefined, checkUrl: URL): Promise<boolean> {
  const cookie = sessionCookie(cookieHeader)
  if (!cookie) return false
  try {
    const response = await fetch(checkUrl, {
      headers: { cookie },
      redirect: 'manual',
      signal: AbortSignal.timeout(2500),
    })
    await response.body?.cancel()
    return response.status === 204
  } catch {
    return false
  }
}

export function isPageRequest(request: IncomingMessage, pathname: string): boolean {
  if (pathname.endsWith('/ws') || /(?:^|\/)api(?:\/|$)/.test(pathname)) return false
  return (request.headers.accept || '').includes('text/html') || !/\.[^/]+$/.test(pathname)
}

export function loginRedirect(loginUrl: string, returnTo: string): string {
  const separator = loginUrl.includes('?') ? '&' : '?'
  return `${loginUrl}${separator}return_to=${encodeURIComponent(returnTo)}`
}
