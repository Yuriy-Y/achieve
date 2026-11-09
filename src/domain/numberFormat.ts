/**
 * Locale-aware display formatting of stored decimal values.
 *
 * Read_Only_Numbers (Daily_Value, Period_Total, Goal value) and Goal_Progress
 * are formatted with `Intl.NumberFormat` in the Device_Locale from exact decimal
 * strings built from milli integers (Req 7.1, 7.3, 11.12, 11.13). No float
 * arithmetic is performed on stored values: the formatter receives an exact
 * decimal string so a value that stores 1234.5 never drifts.
 *
 * This module is display-only. The strings it produces are used for display and
 * ARIA labels and are never re-parsed by the app; input parsing lives in
 * `decimal.ts`.
 */
import type { Milli } from './decimal'

/**
 * Formats stored values and Goal_Progress for display in a resolved locale.
 */
export interface NumberDisplay {
  /**
   * Daily_Value, Period_Total or Goal value: Device_Locale separators and
   * digit grouping, 0-3 fraction digits, with every non-zero fraction digit of
   * the value shown and trailing zero fraction digits dropped (Req 11.12).
   */
  value(v: Milli): string
  /**
   * Goal_Progress from tenths of a percent: exactly one fraction digit followed
   * by the locale's percent sign (Req 7.1, 7.3, 11.13). `475n` -> "47.5%" in an
   * English locale, "47,5 %" in a German locale.
   */
  progress(tenths: bigint): string
}

/**
 * Builds a `NumberDisplay` for the given locale list.
 *
 * `locales` is `navigator.languages` in the browser; `undefined` means the
 * runtime default locale. The two underlying `Intl.NumberFormat` instances are
 * created once here and reused for every call, so `useNumberDisplay` can rebuild
 * them only when the `languagechange` event fires.
 */
export function createNumberDisplay(locales: readonly string[] | undefined): NumberDisplay {
  // A mutable copy satisfies the Intl.NumberFormat signature, which does not
  // accept a readonly array.
  const resolvedLocales = locales === undefined ? undefined : [...locales]

  const valueFormat = new Intl.NumberFormat(resolvedLocales, {
    maximumFractionDigits: 3,
  })
  const progressFormat = new Intl.NumberFormat(resolvedLocales, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })

  return {
    value(v: Milli): string {
      return formatExact(valueFormat, milliDecimalString(v))
    },
    progress(tenths: bigint): string {
      return formatExact(progressFormat, progressFractionString(tenths))
    },
  }
}

/**
 * Exact decimal string for a milli value, used as formatter input.
 *
 * Integer and fraction parts are split from the milli integer with `Math.trunc`
 * and `%`, so no float arithmetic touches the stored value: `1234500` ->
 * "1234.5", `475` -> "0.475", `0` -> "0". Trailing zero fraction digits are
 * dropped, matching the value formatter's `maximumFractionDigits: 3` so grouping
 * and separators come purely from the locale (Req 11.12).
 */
export function milliDecimalString(v: Milli): string {
  const negative = v < 0
  const abs = Math.abs(v)
  const integerPart = Math.trunc(abs / 1000)
  const fractionPart = abs % 1000

  let result: string
  if (fractionPart === 0) {
    result = String(integerPart)
  } else {
    // Zero-pad to three digits, then drop trailing zeros.
    const fraction = String(fractionPart).padStart(3, '0').replace(/0+$/, '')
    result = `${integerPart}.${fraction}`
  }

  return negative ? `-${result}` : result
}

/**
 * Exact decimal string for a Goal_Progress, expressed as a fraction of 1 for the
 * `style: 'percent'` formatter.
 *
 * The formatter multiplies its input by 100, so tenths of a percent become a
 * fraction with three decimal places: `475n` -> "0.475" (shown as 47.5 %),
 * `1000n` -> "1" (100.0 %), `0n` -> "0" (0.0 %). Built from the `bigint` with
 * string arithmetic so very large progress values stay exact (Req 7.3, 11.13).
 */
export function progressFractionString(tenths: bigint): string {
  const negative = tenths < 0n
  const abs = negative ? -tenths : tenths
  // tenths / 1000 as an exact decimal: tenths of a percent -> fraction of 1.
  const integerPart = abs / 1000n
  const fractionPart = abs % 1000n

  let result: string
  if (fractionPart === 0n) {
    result = integerPart.toString()
  } else {
    const fraction = fractionPart.toString().padStart(3, '0').replace(/0+$/, '')
    result = `${integerPart.toString()}.${fraction}`
  }

  return negative ? `-${result}` : result
}

/**
 * Formats an exact decimal string through an `Intl.NumberFormat`.
 *
 * Since ES2023 (Intl.NumberFormat v3) `format()` treats a string argument as an
 * exact decimal, so no precision is lost for the long values this app displays
 * (goal max 999,999,999.999; progress up to about 3.1 x 10^13 tenths). The spike
 * (S) confirmed the target Safari and Chrome versions implement this.
 *
 * In an engine without exact string formatting the string is converted with
 * `Number()`. That is still correct here: every displayed value has at most 15
 * significant digits, so the nearest double rounds back to the exact 3- or
 * 1-decimal result.
 */
function formatExact(formatter: Intl.NumberFormat, decimalString: string): string {
  try {
    return formatter.format(decimalString as unknown as number)
  } catch {
    return formatter.format(Number(decimalString))
  }
}
