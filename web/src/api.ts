import type { RadarSession, RadarTarget, ResolvedTarget } from './types'

export const API_BASE = (import.meta.env.VITE_API_BASE || 'https://trashbox.tech').replace(/\/$/, '')

interface ApiEnvelope<T> {
  code: number
  data: T
  message?: string
}

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.detail || `请求失败 (${response.status})`)
  return body.data as T
}

export const api = {
  createChallenge: () => request<{ challenge_token: string; qr_payload: string; expires_at: string }>(
    '/api/v1/web-auth/challenges', undefined, { method: 'POST' },
  ),
  pollChallenge: (code: string) => request<{ status: string; access_token?: string }>(
    `/api/v1/web-auth/challenges/${encodeURIComponent(code)}`,
  ),
  steamLoginUrl: `${API_BASE}/api/v1/web-auth/steam/login`,
  targets: (token: string) => request<RadarTarget[]>('/api/v1/radar/targets', token),
  snapshot: (token: string) => request<{ targets: RadarTarget[]; session: RadarSession | null }>(
    '/api/v1/radar/snapshot', token, { method: 'POST' },
  ),
  session: (token: string) => request<RadarSession | null>('/api/v1/radar/sessions', token),
  startSession: (token: string) => request<RadarSession>(
    '/api/v1/radar/sessions', token, { method: 'POST', body: JSON.stringify({ duration_seconds: 600 }) },
  ),
  resolve: (token: string, value: string) => request<ResolvedTarget>(
    '/api/v1/radar/resolve', token, { method: 'POST', body: JSON.stringify({ value }) },
  ),
  addTarget: (token: string, payload: object) => request<never>(
    '/api/v1/radar/targets', token, { method: 'POST', body: JSON.stringify(payload) },
  ),
  updateTarget: (token: string, id: number, payload: object) => request<never>(
    `/api/v1/radar/targets/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) },
  ),
  removeTarget: (token: string, id: number) => request<never>(
    `/api/v1/radar/targets/${id}`, token, { method: 'DELETE' },
  ),
}
