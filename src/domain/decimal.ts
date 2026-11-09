/**
 * Exact decimal handling for the Achievement Tracker.
 *
 * All Daily_Values and Goal values are represented as integer thousandths
 * ("milli" units): `12.345` is stored as `12345`. Keeping an integer avoids
 * floating-point drift in Period_Totals, comparisons and the round-trip
 * guarantees (Requirements 9.3, 12.17). Parsing builds the integer with
 * `BigInt` from the digit strings, so even very long inputs never lose
 * precision before the range check (the spike confirmed string handling is
 * needed). Every function here is pure.
 */

import { err, ok, type Result } from './result'

/** Integer number of thousandths. Always a safe integer once produced here. */
export type Milli = number

// Range constants, expressed in milli units.
export const DAILY_MIN: Milli = 0 // 0.000
export const DAILY_MAX: Milli = 999_999_999 // 999,999.999
export const GOAL_MIN: Milli = 1 // 0.001
export const GOAL_MAX: Milli = 999_999_999_999 // 999,999,999.999

/** Why a value string could not be parsed. */
export type ParseError = 'empty' | 'format' | 'range'

/**
 * Grammar shared by Daily_Value and Goal value input (Requirement 11.4):
 * optional integer part, optional single "." or "," decimal separator followed
 * by 1-3 fraction digits. No sign, exponent, grouping or second separator.
 * Either `digits`, `.digits` or `digits.digits` is accepted.
 */
const VALUE_GRAMMAR = /^(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/

/**
 * Strict Backup_File grammar (Requirement 12.1): an integer part with no
 * leading zeros (or a single `0`) and exactly three fraction digits, e.g.
 * `"12.340"` or `"0.000"`.
 */
const FIXED3_GRAMMAR = /^(?:0|[1-9]\d*)\.\d{3}$/

/**
 * Convert a validated number string to milli using BigInt, so arbitrarily long
 * digit strings keep full precision. The string must already match
 * VALUE_GRAMMAR. Returns a `bigint` so the caller can range-check before
 * narrowing to `number`.
 */
function toMilliBigInt(normalised: string): bigint {
  const separatorIndex = normalised.search(/[.,]/)
  if (separatorIndex === -1) {
    // Integer only: multiply by 1000.
    return BigInt(normalised) * 1000n
  }
  const integerPart = normalised.slice(0, separatorIndex)
  const fractionPart = normalised.slice(separatorIndex + 1)
  // Pad the fraction to exactly 3 digits so the combined value is in milli.
  const fractionMilli = fractionPart.padEnd(3, '0')
  const integerValue = integerPart === '' ? 0n : BigInt(integerPart)
  return integerValue * 1000n + BigInt(fractionMilli)
}

/**
 * Parse an input string against the shared grammar and the given milli range.
 * Whitespace is trimmed first (Requirement 11.4); empty input is `'empty'`.
 */
function parseValue(input: string, min: Milli, max: Milli): Result<Milli, ParseError> {
  const trimmed = input.trim()
  if (trimmed === '') return err('empty')
  if (!VALUE_GRAMMAR.test(trimmed)) return err('format')

  const value = toMilliBigInt(trimmed)
  if (value < BigInt(min) || value > BigInt(max)) return err('range')

  return ok(Number(value))
}

/**
 * Parse a Daily_Value: 0 to 999,999.999 inclusive, at most 3 decimal places,
 * "." or "," as the decimal separator (Requirements 3.4, 4.5, 11.4).
 */
export function parseDailyValue(input: string): Result<Milli, ParseError> {
  return parseValue(input, DAILY_MIN, DAILY_MAX)
}

/**
 * Parse a Goal value: 0.001 to 999,999,999.999 inclusive, at most 3 decimal
 * places, "." or "," as the decimal separator (Requirements 6.7, 11.4).
 */
export function parseGoalValue(input: string): Result<Milli, ParseError> {
  return parseValue(input, GOAL_MIN, GOAL_MAX)
}

/**
 * Canonical input form (Requirements 11.14, 11.16): integer part, then "." and
 * the fraction digits with trailing zeros removed. No grouping, "." separator.
 * `12340 -> "12.34"`, `5000 -> "5"`, `0 -> "0"`.
 */
export function formatMilli(value: Milli): string {
  const integerPart = Math.trunc(value / 1000)
  const fraction = Math.abs(value % 1000)
  if (fraction === 0) return String(integerPart)
  const fractionText = String(fraction).padStart(3, '0').replace(/0+$/, '')
  return `${integerPart}.${fractionText}`
}

/**
 * Fixed three-decimal form for the Backup_File (Requirement 12.1).
 * `12340 -> "12.340"`, `0 -> "0.000"`.
 */
export function formatMilliFixed3(value: Milli): string {
  const integerPart = Math.trunc(value / 1000)
  const fraction = Math.abs(value % 1000)
  return `${integerPart}.${String(fraction).padStart(3, '0')}`
}

/**
 * Parse a strict Backup_File decimal string (exactly 3 fraction digits, no
 * leading zeros) to milli. Grammar-only; no range check (Requirement 12.1).
 */
export function parseFixed3(input: string): Result<Milli, 'format'> {
  if (!FIXED3_GRAMMAR.test(input)) return err('format')
  const [integerPart, fractionPart] = input.split('.')
  const value = BigInt(integerPart) * 1000n + BigInt(fractionPart)
  return ok(Number(value))
}
