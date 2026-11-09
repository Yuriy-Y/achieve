/**
 * `useChartLayout` — measures the chart container and resolves the chart
 * orientation for `BarChart` (design: Domain: viewModels.ts — "useChartLayout
 * (UI layer) supplies the inputs", and UI components — `BarChart` /
 * `useChartLayout`).
 *
 * The pure orientation rule lives in the domain layer (`chartOrientation`), so
 * this hook only gathers the two browser inputs it needs and feeds them in:
 *
 * - `isWideViewport`: `window.matchMedia('(min-width: 768px)')` with a `change`
 *   listener, matching `WIDE_VIEWPORT_MIN_PX` (Req 5.12-5.14).
 * - `containerWidthPx`: the content-box width of the chart container, observed
 *   with a `ResizeObserver` so the layout follows the container as it changes
 *   (Req 5.13, 5.15).
 *
 * The first width measurement is taken synchronously in the container ref
 * callback with `getBoundingClientRect()` to avoid a flash of the wrong layout.
 * Until that measurement arrives the measured width is 0, so `chartOrientation`
 * resolves to `'rows'`, which is valid at any width (design: "the first
 * measurement is taken in useLayoutEffect ... until then the chart renders
 * rows, which are valid at any width", Req 5.12, 5.14). The viewport flag is
 * read once with a lazy `useState` initializer so the first render is already
 * correct, and is updated only from the media-query `change` listener.
 *
 * Environments without `ResizeObserver` or `matchMedia` (older engines, the
 * jsdom test runner by default) are handled gracefully: the hook falls back to
 * a one-off `getBoundingClientRect()` measurement, a narrow viewport, and so to
 * the always-valid row layout, without throwing (design: "Handle
 * no-ResizeObserver gracefully").
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { RefCallback } from 'react'

import { WIDE_VIEWPORT_MIN_PX, chartOrientation } from '../domain/viewModels'

/** The orientation and the measured geometry returned by {@link useChartLayout}. */
export interface ChartLayout {
  /** Ref callback to attach to the chart container element. */
  containerRef: RefCallback<HTMLElement | null>
  /** The resolved orientation for the current viewport and container width. */
  orientation: 'columns' | 'rows'
  /** Whether the viewport is a Wide_Viewport (>= WIDE_VIEWPORT_MIN_PX). */
  isWideViewport: boolean
  /** The last measured content-box width of the container, in CSS pixels. */
  containerWidthPx: number
}

/** The media query for a Wide_Viewport, built from `WIDE_VIEWPORT_MIN_PX`. */
const WIDE_VIEWPORT_QUERY = `(min-width: ${WIDE_VIEWPORT_MIN_PX}px)`

/** Read the current viewport flag, defaulting to narrow when `matchMedia` is absent. */
function readWideViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(WIDE_VIEWPORT_QUERY).matches
}

/**
 * Measure the container width and track the viewport, returning the chart
 * orientation for the given number of positions.
 *
 * @param positionCount the number of Day positions in the chart (7 or 28-31),
 *   used by `chartOrientation` to check the 44px-per-Day fit (Req 5.13, 5.15).
 */
export function useChartLayout(positionCount: number): ChartLayout {
  const elementRef = useRef<HTMLElement | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const [containerWidthPx, setContainerWidthPx] = useState(0)
  // Read the viewport flag once at mount (lazy initializer) so the first render
  // already has the correct value without a synchronous setState in an effect.
  const [isWideViewport, setIsWideViewport] = useState(readWideViewport)

  // Subscribe to Narrow/Wide viewport changes; setState happens only inside the
  // media-query `change` listener, never synchronously in the effect body
  // (Req 5.12-5.14).
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return
    }
    const mql = window.matchMedia(WIDE_VIEWPORT_QUERY)
    const onChange = (event: MediaQueryListEvent): void => {
      setIsWideViewport(event.matches)
    }
    mql.addEventListener('change', onChange)
    return () => {
      mql.removeEventListener('change', onChange)
    }
  }, [])

  // Observe the container's content-box width. The first measurement is taken
  // synchronously here so the correct layout is chosen before paint; a
  // ResizeObserver then keeps it up to date. Falls back to a single
  // getBoundingClientRect measurement when ResizeObserver is unavailable.
  const observe = useCallback((element: HTMLElement): void => {
    setContainerWidthPx(element.getBoundingClientRect().width)
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const boxWidth = entry.contentBoxSize?.[0]?.inlineSize
        setContainerWidthPx(boxWidth ?? entry.contentRect.width)
      }
    })
    observer.observe(element)
    observerRef.current = observer
  }, [])

  const disconnect = useCallback((): void => {
    observerRef.current?.disconnect()
    observerRef.current = null
  }, [])

  // Ref callback: (dis)connect the observer as the element mounts/unmounts, so
  // the hook needs no separate cleanup effect and re-observes on element swap.
  const containerRef = useCallback<RefCallback<HTMLElement | null>>(
    (element) => {
      disconnect()
      elementRef.current = element
      if (element !== null) {
        observe(element)
      }
    },
    [observe, disconnect],
  )

  const orientation = chartOrientation(isWideViewport, containerWidthPx, positionCount)

  return { containerRef, orientation, isWideViewport, containerWidthPx }
}
