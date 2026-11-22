/**
 * Remembers on this device whether the Analyser has been revealed (Req 16.1).
 * Stored in `localStorage`; when storage is unavailable the flag lives in memory
 * for the session.
 */
import { useCallback, useState } from 'react'

export const ANALYSER_REVEALED_KEY = 'achievement-tracker.analyserRevealed'

function read(): boolean {
  try {
    return localStorage.getItem(ANALYSER_REVEALED_KEY) === 'true'
  } catch {
    return false
  }
}

function write(value: boolean): void {
  try {
    if (value) localStorage.setItem(ANALYSER_REVEALED_KEY, 'true')
    else localStorage.removeItem(ANALYSER_REVEALED_KEY)
  } catch {
    // Storage unavailable: the in-memory state still applies for this session.
  }
}

export function useAnalyserRevealed(): [boolean, (revealed: boolean) => void] {
  const [revealed, setRevealed] = useState<boolean>(read)
  const set = useCallback((value: boolean): void => {
    write(value)
    setRevealed(value)
  }, [])
  return [revealed, set]
}
