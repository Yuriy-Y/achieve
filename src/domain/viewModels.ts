/**
 * Pure view-model derivation for the Achievement Tracker UI.
 *
 * Everything here is a pure selector from a `Dataset`, `today` and the current
 * view state (the selected Period and view type). There is no React, no browser
 * API and no I/O. The UI layer feeds the viewport flag and the measured chart
 * container width into `chartOrientation`; the pure rule lives here so it can be
 * property-tested in isolation (design: "Domain: viewModels.ts").
 *
 * Covered requirements: 2.2, 2.3, 2.4, 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.8, 5.9,
 * 5.10, 5.11, 5.12, 5.13, 5.14, 5.15, 6.9, 7.1, 7.5, 8.9, 8.10 and 12.22.
 *
 * Numbers that appear on screen or in ARIA labels are formatted through the
 * supplied `NumberDisplay` (Device_Locale, Req 7.1, 11.12, 11.13). Calendar
 * titles use a fixed `Intl.DateTimeFormat('en-GB')` as the design specifies, so
 * they do not vary with the Device_Locale.
 */
import type { Dataset } from './dataset'
import type { GoalType, LocalDate, Period } from './calendar'
import {
  comparePeriods,
  currentPeriod,
  daysOf,
  nextPeriod,
  periodEnd,
  periodOf,
  periodStart,
  prevPeriod,
} from './calendar'
import type { Milli } from './decimal'
import type { NumberDisplay } from './numberFormat'
import { resolveEffectiveGoal } from './goals'
import { goalProgressTenths, goalStatus, periodTotal, type GoalStatus } from './stats'

/** Minimum CSS pixels for a Touch_Target in either dimension (Req 11.2). */
export const TOUCH_MIN_PX = 44
/** Narrow/Wide viewport boundary in CSS pixels (Req 5.12-5.14). */
export const WIDE_VIEWPORT_MIN_PX = 768

/**
 * Goal details for one Goal type and Period: the Effective_Goal, the progress
 * both as tenths (for exact comparison) and as locale display text, and the
 * Goal_Status (Req 5.7, 7.1, 7.5).
 */
export interface GoalSummary {
  goalType: GoalType
  goal: Milli
  progressTenths: bigint
  progressText: string
  status: GoalStatus
}

/**
 * One row of the Activity list: the Activity, today's stored Daily_Value (0 when
 * none is stored, Req 2.3) and a `GoalSummary` per Goal type that has an
 * Effective_Goal in its Current_Period (Req 2.4).
 */
export interface ActivityRowModel {
  id: string
  name: string
  todayValue: Milli
  goals: GoalSummary[]
}

/**
 * The Activity list model (Req 2.2, 2.3, 2.4, 6.9).
 *
 * Rows are ordered by creation time, oldest first, breaking ties on
 * `createdSeq` so the order stays stable after an import (Req 2.2). Each row
 * carries today's stored value or 0 (Req 2.3) and a `GoalSummary` for exactly
 * those Goal types with an Effective_Goal in their Current_Period (Req 2.4,
 * 6.9).
 */
export function activityListModel(
  ds: Dataset,
  today: LocalDate,
  fmt: NumberDisplay,
): ActivityRowModel[] {
  const ordered = [...ds.activities].sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1
    if (a.createdAt > b.createdAt) return 1
    return a.createdSeq - b.createdSeq
  })

  return ordered.map((activity) => {
    const todayValue = ds.values.get(activity.id)?.get(today) ?? 0
    const goals: GoalSummary[] = []
    for (const goalType of GOAL_TYPES) {
      const period = currentPeriod(today, goalType)
      const summary = goalSummaryFor(ds, activity.id, period, today, fmt)
      if (summary !== null) goals.push(summary)
    }
    return { id: activity.id, name: activity.name, todayValue, goals }
  })
}

/** The two Goal types in a fixed order (weekly before monthly). */
const GOAL_TYPES: readonly GoalType[] = ['weekly', 'monthly']

/**
 * The `GoalSummary` of an Activity for a Period, or `null` when no
 * Effective_Goal of the Period's type applies (Req 6.9, 8.9). The status and
 * progress come from the unrounded Period_Total so display and status stay
 * consistent (Req 7.5, 7.6).
 */
function goalSummaryFor(
  ds: Dataset,
  activityId: string,
  period: Period,
  today: LocalDate,
  fmt: NumberDisplay,
): GoalSummary | null {
  const goal = resolveEffectiveGoal(ds.goalVersions, activityId, period)
  if (goal === null) return null
  const total = periodTotal(ds.values, activityId, period)
  const progressTenths = goalProgressTenths(total, goal)
  return {
    goalType: period.type,
    goal,
    progressTenths,
    progressText: fmt.progress(progressTenths),
    status: goalStatus(total, goal, period, today),
  }
}

/**
 * One position on the chart: a single Day of the selected Period.
 *
 * `value` is the stored Daily_Value, or 0 for a Day on or before today without
 * a stored value (Req 5.3), or `null` for a future Day with no imported value
 * (Req 5.6, 12.22). `isFuture` is true for Days after today. `ariaLabel`
 * contains the Day's date and either the value or "future" (followed by the
 * imported value when one exists) (Req 5.9).
 */
export interface ChartPosition {
  date: LocalDate
  value: Milli | null
  isFuture: boolean
  ariaLabel: string
}

/**
 * The chart model for one Activity and selected Period (Req 5.1-5.3, 5.6-5.10,
 * 8.9, 8.10, 12.22).
 */
export interface ChartModel {
  period: Period
  title: string
  positions: ChartPosition[]
  total: Milli
  goal: GoalSummary | null
  isCurrent: boolean
  canGoNext: boolean
  pastNoGoalText: 'no goal applied' | null
}

/**
 * Build the chart model for an Activity and selected Period (Req 5.1-5.3, 5.6,
 * 5.7, 5.8, 5.9, 5.10, 8.9, 8.10, 12.22).
 *
 * `positions` are exactly `daysOf(period)` in ascending order: 7 for a Week,
 * 28-31 for a Month (Req 5.1, 5.2). A Day on or before today reads its stored
 * value or 0 (Req 5.3); a Day after today is marked future and shows its
 * imported value or `null` (Req 5.6, 12.22). The Period_Total includes any
 * future-dated imported values inside the Period (Req 12.22).
 *
 * `goal` is non-null only when an Effective_Goal of the view type applies to the
 * Period (Req 5.7, 5.8, 6.9); `pastNoGoalText` is "no goal applied" exactly for
 * a past Period without an Effective_Goal (Req 8.10). `canGoNext` is false
 * exactly for the Current_Period, so future Periods are not reachable by
 * navigation (Req 5.10).
 */
export function chartModel(
  ds: Dataset,
  activityId: string,
  period: Period,
  today: LocalDate,
  fmt: NumberDisplay,
): ChartModel {
  const activityValues = ds.values.get(activityId)
  const positions: ChartPosition[] = daysOf(period).map((date) => {
    const stored = activityValues?.get(date)
    const isFuture = date > today
    if (isFuture) {
      const value = stored ?? null
      return { date, value, isFuture, ariaLabel: futureAriaLabel(date, value, fmt) }
    }
    const value = stored ?? 0
    return { date, value, isFuture, ariaLabel: pastAriaLabel(date, value, fmt) }
  })

  const total = periodTotal(ds.values, activityId, period)
  const goal = goalSummaryFor(ds, activityId, period, today, fmt)
  const current = currentPeriod(today, period.type)
  const isCurrent = comparePeriods(period, current) === 0
  const isPast = comparePeriods(period, current) < 0

  return {
    period,
    title: periodTitle(period),
    positions,
    total,
    goal,
    isCurrent,
    canGoNext: !isCurrent,
    pastNoGoalText: isPast && goal === null ? 'no goal applied' : null,
  }
}

/** ARIA label for a Day on or before today: "Monday 9 February 2026: 12.5". */
function pastAriaLabel(date: LocalDate, value: Milli, fmt: NumberDisplay): string {
  return `${fullDate(date)}: ${fmt.value(value)}`
}

/**
 * ARIA label for a future Day: "Sunday 15 February 2026: future", or
 * "Sunday 15 February 2026: future, 3" when an imported value exists (Req 5.9).
 */
function futureAriaLabel(date: LocalDate, value: Milli | null, fmt: NumberDisplay): string {
  const base = `${fullDate(date)}: future`
  return value === null ? base : `${base}, ${fmt.value(value)}`
}

// Fixed en-GB formatters for chart labels and titles (design specifies en-GB).
const FULL_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const WEEK_RANGE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})
const MONTH_TITLE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

/** A `LocalDate` as a UTC `Date` for the fixed en-GB formatters (no TZ drift). */
function toUtcDate(date: LocalDate): Date {
  return new Date(`${date}T00:00:00.000Z`)
}

/** Full date label, e.g. "Monday 9 February 2026". */
function fullDate(date: LocalDate): string {
  return FULL_DATE_FORMAT.format(toUtcDate(date))
}

/**
 * Chart title (Req 5.1, 5.2):
 *   - Week: "Mon 9 Feb 2026 - Sun 15 Feb 2026" (first and last Day).
 *   - Month: "February 2026".
 */
function periodTitle(p: Period): string {
  if (p.type === 'monthly') {
    return MONTH_TITLE_FORMAT.format(toUtcDate(periodStart(p)))
  }
  const start = WEEK_RANGE_FORMAT.format(toUtcDate(periodStart(p)))
  const end = WEEK_RANGE_FORMAT.format(toUtcDate(periodEnd(p)))
  return `${start} \u2013 ${end}`
}

/**
 * Chart orientation (Req 5.12-5.15, 11.1, 11.2).
 *
 * Returns `'columns'` exactly when the viewport is a Wide_Viewport and the
 * container is wide enough for `TOUCH_MIN_PX` per Day
 * (`containerWidthPx >= positionCount * TOUCH_MIN_PX`); otherwise `'rows'`. A
 * Narrow_Viewport always renders rows, which are valid at any width (Req 5.12,
 * 5.14). Rows draw the first Day at the top and columns the first Day on the
 * left, both from the ascending `positions` (Req 5.12, 5.13).
 */
export function chartOrientation(
  isWideViewport: boolean,
  containerWidthPx: number,
  positionCount: number,
): 'columns' | 'rows' {
  if (isWideViewport && containerWidthPx >= positionCount * TOUCH_MIN_PX) {
    return 'columns'
  }
  return 'rows'
}

/**
 * Switch the view type while keeping the user near the same point in time
 * (Req 5.11).
 *
 * When the selected Period is the Current_Period of its type, the result is the
 * Current_Period of the new type. Otherwise it is the Period of the new type
 * that contains the first Day of the previously selected Period.
 */
export function switchViewType(selected: Period, newType: GoalType, today: LocalDate): Period {
  if (newType === selected.type) return selected
  const current = currentPeriod(today, selected.type)
  if (comparePeriods(selected, current) === 0) {
    return currentPeriod(today, newType)
  }
  return periodOf(periodStart(selected), newType)
}

/**
 * Navigate to the adjacent Period of the same type (Req 5.5, 5.10).
 *
 * Moving to the previous Period always works. Moving to the next Period is
 * gated at the Current_Period: from the Current_Period, `'next'` returns the
 * Current_Period unchanged, so future Periods are never reachable by navigation
 * (Req 5.10). Imported future-dated values still count in the Current_Period
 * total when they fall inside it.
 */
export function navigate(selected: Period, dir: 'prev' | 'next', today: LocalDate): Period {
  if (dir === 'prev') return prevPeriod(selected)
  const current = currentPeriod(today, selected.type)
  if (comparePeriods(selected, current) >= 0) return current
  return nextPeriod(selected)
}
