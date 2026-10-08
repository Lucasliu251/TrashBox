import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { centralAuthUrl, hasSession, isPageRequest, loginRedirect, sessionCookie } from './auth.js'

afterEach(() => vi.unstubAllGlobals())

describe('central session validation', () => {
  const checkUrl = centralAuthUrl('http://127.0.0.1:2026/api/v1/auth/check')

  it('rejects missing, ambiguous and malformed cookies before contacting the backend', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const cookie of [undefined, 'jwt=legacy', 'trashbox_session=', 'trashbox_session=a; trashbox_session=b', 'trashbox_session=bad\r\nvalue']) {
      expect(await hasSession(cookie, checkUrl)).toBe(false)
    }
    expect(fetch).not.toHaveBeenCalled()
    expect(sessionCookie('other=secret; trashbox_session=valid-token; third=secret')).toBe('trashbox_session=valid-token')
  })

  it('forwards only the opaque central cookie and accepts exactly 204', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetch)
    expect(await hasSession('provider_secret=no; trashbox_session=valid-token', checkUrl)).toBe(true)
    expect(fetch).toHaveBeenCalledWith(checkUrl, expect.objectContaining({ headers: { cookie: 'trashbox_session=valid-token' }, redirect: 'manual' }))
    for (const status of [200, 302, 401, 403, 500]) {
      fetch.mockResolvedValueOnce(new Response(null, { status }))
      expect(await hasSession('trashbox_session=valid-token', checkUrl)).toBe(false)
    }
  })

  it('fails closed on an unavailable or timed-out central service', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
    expect(await hasSession('trashbox_session=valid-token', checkUrl)).toBe(false)
  })

  it('restricts the trusted auth endpoint to HTTP loopback', () => {
    for (const url of ['https://example.com/check', 'http://example.com/check', 'http://user:secret@127.0.0.1/check']) {
      expect(() => centralAuthUrl(url)).toThrow()
    }
    expect(centralAuthUrl('http://[::1]:2026/check').hostname).toBe('[::1]')
  })
})

describe('anonymous response policy', () => {
  const request = { headers: { accept: 'text/html' } } as IncomingMessage

  it('returns 401 for API and websocket paths even with a browser Accept header', () => {
    expect(isPageRequest(request, '/game/sniper/ws')).toBe(false)
    expect(isPageRequest(request, '/game/sniper/api/rooms')).toBe(false)
    expect(isPageRequest({ headers: {} } as IncomingMessage, '/game/sniper/assets/app.js')).toBe(false)
    expect(isPageRequest(request, '/game/sniper/')).toBe(true)
  })

  it('encodes the complete relative return route', () => {
    expect(loginRedirect('/login', '/game/sniper/?room=abc&mode=join')).toBe('/login?return_to=%2Fgame%2Fsniper%2F%3Froom%3Dabc%26mode%3Djoin')
  })
})
