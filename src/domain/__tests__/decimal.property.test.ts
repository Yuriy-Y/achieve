// Feature: achievement-tracker, Property 1: Input format/parse round trip with either separator
// Feature: achievement-tracker, Property 2: Decimal parsers accept exactly the valid inputs
// Feature: achievement-tracker, Property 37: Goal_Progress and Goal_Status with negative totals
import fc from 'fast-check'
import {
  DAILY_MAX,
  DAILY_MIN,
  GOAL_MAX,
  GOAL_MIN,
  formatMilli,
  formatMilliFixed3,
  parseDailyValue,
  parseFixed3,
  parseGoalValue,
} from '../decimal'
import { goalProgressTenths } from '../stats'
import { createNumberDisplay, progressFractionString } from '../numberFormat'

const arbDaily = fc.oneof(
  fc.integer({ min: DAILY_MIN, max: DAILY_MAX }),
  fc.constantFrom(DAILY_MIN, DAILY_MIN + 1, -1, 0, 1, DAILY_MAX - 1, DAILY_MAX),
)
const arbGoal = fc.oneof(
  fc.integer({ min: GOAL_MIN, max: GOAL_MAX }),
  fc.constantFrom(GOAL_MIN, GOAL_MIN + 1, GOAL_MAX - 1, GOAL_MAX),
)

describe('Property 1: input round trip', () => {
  it('daily values round-trip with "." and ","', () => {
    fc.assert(
      fc.property(arbDaily, (v) => {
        const text = formatMilli(v)
        expect(text).not.toMatch(/[,\s]/)
        expect(parseDailyValue(text)).toEqual({ ok: true, value: v })
        expect(parseDailyValue(text.replace('.', ','))).toEqual({ ok: true, value: v })
        expect(parseFixed3(formatMilliFixed3(v), true)).toEqual({ ok: true, value: v })
      }),
    )
  })
  it('goal values round-trip', () => {
    fc.assert(
      fc.property(arbGoal, (v) => {
        expect(parseGoalValue(formatMilli(v))).toEqual({ ok: true, value: v })
        expect(parseFixed3(formatMilliFixed3(v))).toEqual({ ok: true, value: v })
      }),
    )
  })
})

describe('Property 2: parser acceptance', () => {
  const reference = (raw: string, signed: boolean, min: number, max: number): number | null => {
    const t = raw.trim()
    const m = /^([-\u2212])?(\d+(?:[.,]\d{1,3})?|[.,]\d{1,3})$/.exec(t)
    if (m === null) return null
    if (m[1] !== undefined && !signed) return null
    const [i = '', f = ''] = m[2].split(/[.,]/)
    let v = BigInt(i === '' ? '0' : i) * 1000n + BigInt(f.padEnd(3, '0'))
    if (m[1] !== undefined) v = -v
    return v < BigInt(min) || v > BigInt(max) ? null : Number(v)
  }
  const arbText = fc.oneof(
    fc.string({ maxLength: 14 }),
    fc.stringMatching(/^ ?[-\u2212+]?[0-9]{0,8}([.,][0-9]{0,5})? ?$/),
    fc.constantFrom('-0', '-', '', ' ', '1e3', '1,000.5', '999999.999', '-999999.999', '1000000', '-1000000', '.5', ',5', '5.'),
  )
  it('daily parser matches the reference grammar', () => {
    fc.assert(
      fc.property(arbText, (raw) => {
        const r = parseDailyValue(raw)
        const ref = reference(raw, true, DAILY_MIN, DAILY_MAX)
        expect(r.ok ? r.value : null).toBe(ref)
      }),
    )
  })
  it('goal parser rejects signs and matches the reference', () => {
    fc.assert(
      fc.property(arbText, (raw) => {
        const r = parseGoalValue(raw)
        const ref = reference(raw, false, GOAL_MIN, GOAL_MAX)
        expect(r.ok ? r.value : null).toBe(ref)
      }),
    )
  })
  it('-0 is stored as 0, never negative zero', () => {
    const r = parseDailyValue('-0')
    expect(r).toEqual({ ok: true, value: 0 })
    expect(Object.is((r as { value: number }).value, -0)).toBe(false)
  })
  it('fixed3 rejects -0.000 and signs unless allowed', () => {
    expect(parseFixed3('-0.000', true).ok).toBe(false)
    expect(parseFixed3('-1.500', false).ok).toBe(false)
    expect(parseFixed3('-1.500', true)).toEqual({ ok: true, value: -1500 })
  })
})

describe('Property 37: Goal_Progress with negative totals', () => {
  const arbTotal = fc.integer({ min: -31 * DAILY_MAX, max: 31 * DAILY_MAX })
  it('is odd-symmetric, exact and monotonic', () => {
    fc.assert(
      fc.property(arbTotal, arbGoal, (t, g) => {
        const p = goalProgressTenths(t, g)
        expect(goalProgressTenths(-t, g)).toBe(-p)
        // exact rational reference: round(|t| * 1000 / g) half up on the magnitude
        const num = BigInt(Math.abs(t)) * 1000n
        const gb = BigInt(g)
        let q = num / gb
        if ((num % gb) * 2n >= gb) q += 1n
        expect(p).toBe(t < 0 ? -q : q)
        if (t < DAILY_MAX * 31) expect(goalProgressTenths(t + 1, g) >= p).toBe(true)
      }),
    )
  })
  it('shows 0.0% without a sign for tiny negatives and -12.5% for -125 tenths', () => {
    const display = createNumberDisplay(['en-GB'])
    expect(goalProgressTenths(-1, 1_000_000)).toBe(0n)
    expect(display.progress(0n)).toBe('0.0%')
    expect(progressFractionString(-125n)).toBe('-0.125')
    expect(display.progress(-125n)).toBe('-12.5%')
  })
})
