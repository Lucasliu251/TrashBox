import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { startGameSessionActivity } from './auth'

const { authRequest, getAuthSession } = vi.hoisted(() => ({ authRequest: vi.fn(), getAuthSession: vi.fn() }))
vi.mock('../../../../shared/auth', () => ({
  authRequest, getAuthSession, redirectToLogin: vi.fn(),
  AuthRequestError: class extends Error { constructor(public status: number) { super() } },
}))

let previewWindow: EventTarget
let previewDocument: EventTarget & { visibilityState: string; hasFocus: () => boolean; pointerLockElement: object | null }
let stop: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-08T00:00:00Z'))
  authRequest.mockReset().mockResolvedValue({})
  getAuthSession.mockReset().mockResolvedValue({ authenticated: true })
  previewWindow = Object.assign(new EventTarget(), { setInterval, clearInterval })
  previewDocument = Object.assign(new EventTarget(), { visibilityState: 'visible', hasFocus: () => true, pointerLockElement: null })
  vi.stubGlobal('window', previewWindow)
  vi.stubGlobal('document', previewDocument)
})

afterEach(() => { stop(); vi.unstubAllGlobals(); vi.useRealTimers() })

function input(type: string, trusted = true, motion = false) {
  const event = new Event(type)
  Object.defineProperty(event, 'isTrusted', { value: trusted })
  if (motion) Object.assign(event, { movementX: 3, movementY: 0 })
  previewWindow.dispatchEvent(event)
}

it('extends the session only for trusted foreground input and throttles writes', async () => {
  stop = startGameSessionActivity(vi.fn())
  input('keydown', false)
  expect(authRequest).not.toHaveBeenCalled()
  input('keydown')
  input('pointerdown')
  expect(authRequest).toHaveBeenCalledTimes(1)
  expect(authRequest).toHaveBeenCalledWith('/api/v1/auth/activity', { method: 'POST' })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(getAuthSession).toHaveBeenCalled()
  expect(authRequest).toHaveBeenCalledTimes(1)
  previewDocument.visibilityState = 'hidden'
  input('keydown')
  expect(authRequest).toHaveBeenCalledTimes(1)
  previewDocument.visibilityState = 'visible'
  previewDocument.hasFocus = () => false
  input('pointerdown')
  expect(authRequest).toHaveBeenCalledTimes(1)
})

it('counts pointer-lock aiming while idle mouse movement and polling do not extend a session', async () => {
  stop = startGameSessionActivity(vi.fn())
  input('mousemove', true, true)
  expect(authRequest).not.toHaveBeenCalled()
  previewDocument.pointerLockElement = {}
  input('mousemove', true)
  expect(authRequest).not.toHaveBeenCalled()
  input('mousemove', true, true)
  expect(authRequest).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(180_000)
  expect(authRequest).toHaveBeenCalledTimes(1)
})

it('expires the client when the periodic session check returns 401 and cleans up listeners', async () => {
  const expired = vi.fn()
  getAuthSession.mockResolvedValue(null)
  stop = startGameSessionActivity(expired)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(expired).toHaveBeenCalledTimes(1)
  stop()
  input('keydown')
  expect(authRequest).not.toHaveBeenCalled()
})
