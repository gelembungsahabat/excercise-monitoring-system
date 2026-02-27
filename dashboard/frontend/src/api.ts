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
}
