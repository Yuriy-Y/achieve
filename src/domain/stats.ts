/**
 * Period statistics for the Achievement Tracker (pure functions, no I/O).
 * Covers the design's "Domain: stats.ts" section and Requirements 4.2, 4.7,
 * 7.2, 7.3, 7.4, 7.6, 7.8, 7.9 and 12.22.
 *
 * All arithmetic is exact. Daily_Values and Goal values are integer milli
 * units (see `decimal.ts`), so Period_Totals are exact integers and never
 * drift. Goal_Progress is computed with `BigInt` and reported in tenths of a
 * percent (a `bigint`), matching `numberFormat.ts`'s `progress(tenths: bigint)`
 * so no rounding happens on the display side. Goal_Status compares the
 * unrounded milli integers directly, so the status is always consistent with
 * the true total rather than with the rounded percentage (Req 7.6).
 */
import type { DailyValueIndex } from './dataset'
import type { LocalDate, Period } from './calendar'
import { daysOf, periodEnd, compareDates } from './calendar'
import type { Milli } from './decimal'

/**
 * Period_Total of one Activity for a Period: the sum of its stored Daily_Values
 * over every Day of the Period (Req 4.2). Days without a stored value read as 0
 * (`dailyValue`), and imported future-dated values inside the Period are
 * included (Req 12.22).
 *
 * The sum stays an exact safe integer: the largest possible monthly total is
 * 31 x 999,999,999 milli, far below `Number.MAX_SAFE_INTEGER`.
 */
export function periodTotal(values: DailyValueIndex, activityId: string, p: Period): Milli {
  const activityValues = values.get(activityId)
  if (activityValues === undefined) return 0
  let total = 0
  for (const date of daysOf(p)) {
    // A Day with no stored value reads as 0 (Req 3.1).
    total += activityValues.get(date) ?? 0
  }
  return total
}

/**
 * Goal_Progress in tenths of a percent, rounded half away from zero (Req 7.2).
 * `475n` means 47.5 %. Display goes through `NumberDisplay.progress`.
 *
 * Progress in tenths is `total x 1000 / goal` (percent x 10). Both inputs are
 * non-negative, so half-away-from-zero equals half-up, computed exactly with
 * `BigInt` floor division as `(2 x total x 1000 + goal) / (2 x goal)`:
 *   - a total of 0 gives `0n`, displayed as 0.0 % (Req 7.3);
 *   - results above 100 % (1000 tenths) are not capped (Req 7.4).
 */
export function goalProgressTenths(total: Milli, goal: Milli): bigint {
  const totalBig = BigInt(total)
  const goalBig = BigInt(goal)
  return (2n * totalBig * 1000n + goalBig) / (2n * goalBig)
}

/** The achievement state of a Period against its Effective_Goal. */
export type GoalStatus = 'Achieved' | 'In progress' | 'Not achieved'

/**
 * Goal_Status from the unrounded milli comparison and the Period's end versus
 * today (Req 4.7, 7.6, 7.8, 7.9):
 *   - "Achieved" exactly when `total >= goal` (Req 7.6), so a total of 999.999
 *     against a goal of 1000 is not "Achieved" even though it displays 100.0 %;
 *   - otherwise "In progress" while the Period still has today or a later Day
 *     to run (`periodEnd(p) >= today`, Req 7.9);
 *   - otherwise "Not achieved" once the Period has ended (Req 7.8, 4.7).
 */
export function goalStatus(total: Milli, goal: Milli, p: Period, today: LocalDate): GoalStatus {
  if (total >= goal) return 'Achieved'
  if (compareDates(periodEnd(p), today) >= 0) return 'In progress'
  return 'Not achieved'
}
