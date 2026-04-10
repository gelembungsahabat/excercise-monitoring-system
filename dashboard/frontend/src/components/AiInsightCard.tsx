import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Loader } from 'lucide-react'

interface Props {
  sessionId: string
}

type Status = 'idle' | 'loading' | 'done' | 'error' | 'unavailable'

export function AiInsightCard({ sessionId }: Props) {
  const [status,  setStatus]  = useState<Status>('idle')
  const [insight, setInsight] = useState<string | null>(null)
  const [model,   setModel]   = useState<string>('')
  const [error,   setError]   = useState<string | null>(null)

  const fetchInsight = useCallback(async () => {
    setStatus('loading')
    setInsight(null)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/insight`)
      if (res.status === 503) {
        setStatus('unavailable')
        return
      }
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText)
        throw new Error(text)
      }
      const data = await res.json()
      setInsight(data.insight)
      setModel(data.model ?? '')
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
      setStatus('error')
    }
  }, [sessionId])

  // Auto-fetch when sessionId changes (but only once per session)
  useEffect(() => {
    setStatus('idle')
    setInsight(null)
  }, [sessionId])

  return (
    <div className="card">
      <div className="card__head">
        <div className="card__head-left">
          <div className="card__title-icon"><Sparkles size={14} /></div>
          <span className="card__title">AI Coach Insight</span>
        </div>
        {model && (
          <span style={{ fontSize: 'var(--t-xs)', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
            {model}
          </span>
        )}
      </div>

      <div className="card__body" style={{ padding: '16px 20px' }}>

        {/* Idle */}
        {status === 'idle' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text-dim)', flex: 1 }}>
              Get personalized coaching feedback for this session powered by AI.
            </p>
            <button className="btn btn--primary" onClick={fetchInsight} style={{ flexShrink: 0 }}>
              Analyze Session
            </button>
          </div>
        )}

        {/* Loading */}
        {status === 'loading' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-dim)' }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-flex' }}><Loader size={18} /></span>
            <span style={{ fontSize: 'var(--t-sm)' }}>Analyzing your workout…</span>
          </div>
        )}

        {/* Done */}
        {status === 'done' && insight && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{
              margin: 0,
              fontSize: 'var(--t-sm)',
              lineHeight: 1.75,
              color: 'var(--text-p)',
              borderLeft: '3px solid var(--brand)',
              paddingLeft: 14,
            }}>
              {insight}
            </p>
            <button
              className="btn btn--ghost"
              onClick={fetchInsight}
              style={{ alignSelf: 'flex-start', fontSize: 'var(--t-xs)' }}
            >
              Regenerate
            </button>
          </div>
        )}

        {/* Unavailable (no API key) */}
        {status === 'unavailable' && (
          <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: 'var(--text-dim)' }}>
            AI insights are disabled. Set the{' '}
            <code style={{ background: 'var(--input-bg)', padding: '1px 6px', borderRadius: 4 }}>
              OPENROUTER_API_KEY
            </code>{' '}
            environment variable to enable them.
          </p>
        )}

        {/* Error */}
        {status === 'error' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 'var(--t-sm)', color: '#ef4444', flex: 1 }}>
              {error}
            </p>
            <button className="btn btn--ghost" onClick={fetchInsight} style={{ flexShrink: 0 }}>
              Retry
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
