/**
 * React hook exposing the current `NumberDisplay` for the Device_Locale.
 *
 * Read_Only_Numbers (Daily_Value, Period_Total, Goal value) and Goal_Progress
 * are displayed with the decimal separator and digit grouping of the
 * Device_Locale (Req 7.1, 11.12, 11.13). The locale comes from
 * `navigator.languages`; when the user changes the device or browser language
 * the `languagechange` event fires and the formatters are rebuilt so every
 * consumer re-renders with the new locale (per design, `useNumberDisplay`).
 *
 * The hook subscribes to `languagechange` through `useSyncExternalStore`, so
 * the returned `NumberDisplay` is stable between locale changes and identity
 * changes exactly when the locale changes, giving React a precise signal to
 * re-render consumers. Formatter construction (two `Intl.NumberFormat`
 * instances) therefore happens once per locale, not once per render.
 */
import { useSyncExternalStore } from 'react'

import { createNumberDisplay, type NumberDisplay } from '../domain/numberFormat'

/**
 * Snapshot of the locale list used to build the current `NumberDisplay`.
 *
 * `navigator.languages` is read fresh on every snapshot. A `languagechange`
 * event normally means the list changed, but the value is compared so that a
 * spurious event does not force a rebuild (and so `useSyncExternalStore` keeps a
 * stable snapshot between genuine changes).
 */
let cachedLocales: readonly string[] | undefined
let cachedDisplay: NumberDisplay | undefined

/** Reads the current locale list from the browser, or `undefined` off-browser. */
function readLocales(): readonly string[] | undefined {
  if (typeof navigator === 'undefined') {
    return undefined
  }
  // navigator.languages is read-only and may be undefined in older engines;
  // fall back to the single navigator.language, then to the runtime default.
  return navigator.languages ?? (navigator.language ? [navigator.language] : undefined)
}

/** True when two locale lists hold the same languages in the same order. */
function sameLocales(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined,
): boolean {
  if (a === b) {
    return true
  }
  if (a === undefined || b === undefined || a.length !== b.length) {
    return false
  }
  return a.every((locale, index) => locale === b[index])
}

/**
 * Returns the current `NumberDisplay`, rebuilding it only when the locale list
 * changes. The cached instance keeps the snapshot stable for
 * `useSyncExternalStore` (which requires a referentially stable value between
 * genuine changes to avoid an infinite render loop).
 */
function getSnapshot(): NumberDisplay {
  const locales = readLocales()
  if (cachedDisplay === undefined || !sameLocales(locales, cachedLocales)) {
    cachedLocales = locales
    cachedDisplay = createNumberDisplay(locales)
  }
  return cachedDisplay
}

/** Subscribes to device locale changes; returns the unsubscribe function. */
function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {}
  }
  window.addEventListener('languagechange', onStoreChange)
  return () => {
    window.removeEventListener('languagechange', onStoreChange)
  }
}

/**
 * React hook returning the current `NumberDisplay`.
 *
 * The result is stable between locale changes and changes identity when the
 * Device_Locale changes, so components that format numbers re-render with the
 * new locale within the rendering frame of the `languagechange` event.
 */
export function useNumberDisplay(): NumberDisplay {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
