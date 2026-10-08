import { AuthRequestError, authRequest, getAuthSession, redirectToLogin } from '../../../../shared/auth'

export { getAuthSession, redirectToLogin }

/** Visible input extends the idle session; simulation frames and socket pings do not. */
export function startGameSessionActivity(onExpired: () => void): () => void {
  let lastActivity = 0
  let lastCheck = 0
  let checking = false
  const input = (event: Event) => {
    if (!event.isTrusted || document.visibilityState !== 'visible' || !document.hasFocus()) return
    if (event.type === 'mousemove') {
      const mouse = event as MouseEvent
      if (!document.pointerLockElement || (!mouse.movementX && !mouse.movementY)) return
    }
    if (Date.now() - lastActivity < 60_000) return
    lastActivity = Date.now()
    void authRequest('/api/v1/auth/activity', { method: 'POST' }).catch(error => {
      if (error instanceof AuthRequestError && error.status === 401) onExpired()
    })
  }
  const check = async () => {
    if (document.visibilityState !== 'visible' || checking || Date.now() - lastCheck < 5_000) return
    lastCheck = Date.now()
    checking = true
    try { if (!await getAuthSession()) onExpired() }
    catch { /* A temporary outage does not change the central session. */ }
    finally { checking = false }
  }
  window.addEventListener('pointerdown', input, { capture: true, passive: true })
  window.addEventListener('keydown', input, true)
  window.addEventListener('mousemove', input, { passive: true })
  window.addEventListener('focus', check)
  document.addEventListener('visibilitychange', check)
  const interval = window.setInterval(check, 60_000)
  return () => {
    window.removeEventListener('pointerdown', input, { capture: true })
    window.removeEventListener('keydown', input, { capture: true })
    window.removeEventListener('mousemove', input)
    window.removeEventListener('focus', check)
    document.removeEventListener('visibilitychange', check)
    window.clearInterval(interval)
  }
}
