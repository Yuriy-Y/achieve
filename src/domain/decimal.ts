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
export const DAILY_MIN: Milli = -999_999_999 // -999,999.999 (negative Daily_Values are allowed, Req 13)
export const DAILY_MAX: Milli = 999_999_999 // 999,999.999
export const GOAL_MIN: Milli = 1 // 0.001
export const GOAL_MAX: Milli = 999_999_999_999 // 999,999,999.999

// Tag_Ratio range (Req 16.8): 0.001..1,000. Zero and negative ratios are not accepted.
export const RATIO_MIN: Milli = 1
export const RATIO_MAX: Milli = 1_000_000
/** The ratio of an unassigned Tag and of the untagged combination: 1.000. */
export const RATIO_ONE: Milli = 1000

/** Why a value string could not be parsed. */
export type ParseError = 'empty' | 'format' | 'range'

/**
 * Grammar shared by Daily_Value and Goal value input (Requirement 11.4):
 * optional integer part, optional single "." or "," decimal separator followed
 * by 1-3 fraction digits. No sign, exponent, grouping or second separator.
 * Either `digits`, `.digits` or `digits.digits` is accepted.
 */
const VALUE_GRAMMAR = /^(?:\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/

/** Daily_Value input may carry one leading "-" or the Unicode minus "\u2212" (Req 11.4, 13.1). */
const SIGN_PREFIX = /^[-\u2212]/

/**
 * Strict Backup_File grammar (Requirement 12.1): an integer part with no
 * leading zeros (or a single `0`) and exactly three fraction digits, e.g.
 * `"12.340"` or `"0.000"`. Format version 2 also allows a leading "-".
 */
const FIXED3_GRAMMAR = /^(?:0|[1-9]\d*)\.\d{3}$/
const FIXED3_SIGNED_GRAMMAR = /^-?(?:0|[1-9]\d*)\.\d{3}$/

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
function parseValue(
  input: string,
  min: Milli,
  max: Milli,
  allowSign: boolean,
): Result<Milli, ParseError> {
  let trimmed = input.trim()
  if (trimmed === '') return err('empty')
  let negative = false
  if (SIGN_PREFIX.test(trimmed)) {
    if (!allowSign) return err('format')
    negative = true
    trimmed = trimmed.slice(1)
  }
  if (!VALUE_GRAMMAR.test(trimmed)) return err('format')

  let value = toMilliBigInt(trimmed)
  if (negative) value = -value
  if (value < BigInt(min) || value > BigInt(max)) return err('range')

  // "-0" parses to 0: negative zero is never stored (BigInt has no -0).
  return ok(Number(value))
}

/**
 * Parse a Daily_Value: -999,999.999 to 999,999.999 inclusive, at most 3 decimal
 * places, "." or "," as the decimal separator, optional leading "-" or "\u2212"
 * (Requirements 3.4, 4.5, 11.4, 13.1).
 */
export function parseDailyValue(input: string): Result<Milli, ParseError> {
  return parseValue(input, DAILY_MIN, DAILY_MAX, true)
}

/**
 * Parse a Goal value: 0.001 to 999,999,999.999 inclusive, at most 3 decimal
 * places, "." or "," as the decimal separator (Requirements 6.7, 11.4).
 */
export function parseGoalValue(input: string): Result<Milli, ParseError> {
  return parseValue(input, GOAL_MIN, GOAL_MAX, false)
}

/**
 * Canonical input form (Requirements 11.14, 11.16): integer part, then "." and
 * the fraction digits with trailing zeros removed. No grouping, "." separator.
 * `12340 -> "12.34"`, `5000 -> "5"`, `0 -> "0"`.
 */
export function formatMilli(value: Milli): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const integerPart = Math.trunc(abs / 1000)
  const fraction = abs % 1000
  if (fraction === 0) return `${sign}${integerPart}`
  const fractionText = String(fraction).padStart(3, '0').replace(/0+$/, '')
  return `${sign}${integerPart}.${fractionText}`
}

/**
 * Fixed three-decimal form for the Backup_File (Requirement 12.1).
 * `12340 -> "12.340"`, `0 -> "0.000"`.
 */
export function formatMilliFixed3(value: Milli): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const integerPart = Math.trunc(abs / 1000)
  const fraction = abs % 1000
  return `${sign}${integerPart}.${String(fraction).padStart(3, '0')}`
}

/**
 * Parse a strict Backup_File decimal string (exactly 3 fraction digits, no
 * leading zeros) to milli. Grammar-only; no range check (Requirement 12.1).
 */
export function parseFixed3(input: string, allowNegative = false): Result<Milli, 'format'> {
  if (!(allowNegative ? FIXED3_SIGNED_GRAMMAR : FIXED3_GRAMMAR).test(input)) return err('format')
  const negative = input.startsWith('-')
  const unsigned = negative ? input.slice(1) : input
  const [integerPart, fractionPart] = unsigned.split('.')
  const value = BigInt(integerPart) * 1000n + BigInt(fractionPart)
  // "-0.000" is not canonical: zero is always written "0.000".
  if (negative && value === 0n) return err('format')
  return ok(Number(negative ? -value : value))
}

/**
 * Parse a Tag_Ratio: 0.001 to 1,000 inclusive, at most 3 decimal places, "." or
 * "," as the decimal separator, no sign (Requirements 16.8, 16.9).
 */
export function parseRatio(input: string): Result<Milli, ParseError> {
  return parseValue(input, RATIO_MIN, RATIO_MAX, false)
}
