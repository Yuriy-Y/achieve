import { useEffect, useRef, useState } from 'react'

import { todayLocal, type LocalDate } from '../domain/calendar'

/**
 * How often the hook re-reads the local clock while the Tracker is open.
 *
 * The design requires the Activity list to refresh today's values within one
 * minute of a date change (Req 2.8) and imported future-dated values to become
 * editable as soon as their Day arrives (Req 12.23). Polling every 30 seconds
 * keeps both well inside the 1-minute limit; `visibilitychange` and `focus`
 * handle the common case of a standalone app resumed after being suspended,
 * where timers do not fire while the app is backgrounded.
 */
const POLL_INTERVAL_MS = 30_000

/**
 * React hook that returns today's `LocalDate` in the user's local time zone and
 * re-renders whenever the calendar day changes.
 *
 * The value is read from the local clock with `todayLocal(new Date())` (the only
 * place a local-clock value enters the app; all other date logic is pure). The
 * day is re-checked every 30 seconds and on `visibilitychange` becoming visible
 * and on window `focus`, so a long-open or suspended app rolls over to the new
 * day without a reload.
 *
 * `onChange`, when supplied, is called with the new `LocalDate` each time the day
 * changes (including the first resolved value). `App` wires this to the store's
 * `setToday`, so today's Daily_Value, the Current_Period, Goal_Status and which
 * Days are editable all follow the real date.
 */
export function useToday(onChange?: (today: LocalDate) => void): LocalDate {
  const [today, setToday] = useState<LocalDate>(() => todayLocal(new Date()))

  // Keep the latest callback without making it an effect dependency, so passing
  // an inline `onChange` does not re-subscribe the listeners on every render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const check = (): void => {
      const next = todayLocal(new Date())
      setToday((prev) => {
        if (prev === next) return prev
        onChangeRef.current?.(next)
        return next
      })
    }

    // Reconcile immediately in case the day already changed before this effect
    // ran (for example the initial state was computed in a previous day).
    check()

    const intervalId = setInterval(check, POLL_INTERVAL_MS)

    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', check)

    return () => {
      clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', check)
    }
  }, [])

  return today
}
