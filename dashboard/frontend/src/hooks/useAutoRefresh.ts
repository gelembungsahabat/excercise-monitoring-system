import { useEffect, useRef } from 'react'

/**
 * Calls `callback` every `intervalMs` while `enabled` is true.
 * Cleans up automatically on unmount or when deps change.
 */
export function useAutoRefresh(
  callback: () => void,
  intervalMs: number,
  enabled: boolean,
) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => savedCallback.current(), intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}
