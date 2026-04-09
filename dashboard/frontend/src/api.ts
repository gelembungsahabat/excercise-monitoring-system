import type { Session, SessionMeta, SessionSummary } from './types'

const BASE = '/api'

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status} ${text}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  /** List all sessions (metadata only). */
  listSessions: (): Promise<SessionMeta[]> =>
    request<SessionMeta[]>('/sessions'),

  /** Fetch a full session including all frames. */
  getSession: (id: string): Promise<Session> =>
    request<Session>(`/sessions/${id}`),

  /** Fetch only the summary (used for live-refresh polling). */
  getSessionSummary: (id: string): Promise<SessionSummary> =>
    request<SessionSummary>(`/sessions/${id}/summary`),

  /** Push live state snapshot from browser tracker to server. */
  postLive: (data: unknown): Promise<{ ok: boolean }> =>
    postJson<{ ok: boolean }>('/live', data),

  /** Save a completed session from browser tracker to server. */
  saveSession: (data: unknown): Promise<{ ok: boolean; id: string }> =>
    postJson<{ ok: boolean; id: string }>('/sessions', data),

  /** Permanently delete a session. */
  deleteSession: (id: string): Promise<{ ok: boolean; id: string }> =>
    del<{ ok: boolean; id: string }>(`/sessions/${id}`),

  /** Classify a BPM value into a fatigue zone (uses ML model on server). */
  classifyBpm: (bpm: number): Promise<{ zone: string }> =>
    request<{ zone: string }>(`/classify-bpm?bpm=${bpm}`),

  // ── Legacy tracker control (no-op stubs — tracker now runs in browser) ──

  /** @deprecated Tracker now runs in browser. Returns running: false always. */
  trackerStatus: (): Promise<{ running: boolean }> =>
    Promise.resolve({ running: false }),

  /** @deprecated No-op. */
  startTracker: (_cameraIndex = 0, _bpm = 120): Promise<{ ok: boolean }> =>
    Promise.resolve({ ok: false }),

  /** @deprecated No-op. */
  stopTracker: (): Promise<{ ok: boolean }> =>
    Promise.resolve({ ok: false }),
}
