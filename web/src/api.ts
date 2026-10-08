import { authRequest, AuthRequestError, redirectToLogin } from '../../shared/auth'
import type { RadarSession, RadarTarget, ResolvedTarget } from './types'

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try { return await authRequest<T>(path, init) }
  catch (cause) {
    if (cause instanceof AuthRequestError && cause.status === 401) redirectToLogin()
    throw cause
  }
}

export const api = {
  targets: () => request<RadarTarget[]>('/api/v1/radar/targets'),
  snapshot: () => request<{ targets: RadarTarget[]; session: RadarSession | null }>(
    '/api/v1/radar/snapshot', { method: 'POST' },
  ),
  session: () => request<RadarSession | null>('/api/v1/radar/sessions'),
  startSession: () => request<RadarSession>(
    '/api/v1/radar/sessions', { method: 'POST', body: JSON.stringify({ duration_seconds: 600 }) },
  ),
  resolve: (value: string) => request<ResolvedTarget>(
    '/api/v1/radar/resolve', { method: 'POST', body: JSON.stringify({ value }) },
  ),
  addTarget: (payload: object) => request<never>(
    '/api/v1/radar/targets', { method: 'POST', body: JSON.stringify(payload) },
  ),
  updateTarget: (id: number, payload: object) => request<never>(
    `/api/v1/radar/targets/${id}`, { method: 'PATCH', body: JSON.stringify(payload) },
  ),
  removeTarget: (id: number) => request<never>(
    `/api/v1/radar/targets/${id}`, { method: 'DELETE' },
  ),
}
