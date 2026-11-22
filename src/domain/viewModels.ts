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
import { dayEntries, dayTotal, type Dataset } from './dataset'
import {
  bucketTotal,
  chartWindow,
  canGoNext,
  type Bucket,
  type WindowSpec,
} from './granularity'
import type { AnalyserModel } from './analyser'
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
    const todayValue = dayTotal(ds, activity.id, today)
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
  const total = periodTotal(ds, activityId, period)
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
  const positions: ChartPosition[] = daysOf(period).map((date) => {
    const stored = dayEntries(ds, activityId, date).length > 0 ? dayTotal(ds, activityId, date) : undefined
    const isFuture = date > today
    if (isFuture) {
      const value = stored ?? null
      return { date, value, isFuture, ariaLabel: futureAriaLabel(date, value, fmt) }
    }
    const value = stored ?? 0
    return { date, value, isFuture, ariaLabel: pastAriaLabel(date, value, fmt) }
  })

  const total = periodTotal(ds, activityId, period)
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
  seriesCount = 1,
): 'columns' | 'rows' {
  // Each position needs 44 px, or 14 px per series when several are drawn side by side.
  const perPosition = Math.max(TOUCH_MIN_PX, SERIES_BAR_PX * seriesCount)
  if (isWideViewport && containerWidthPx >= positionCount * perPosition) {
    return 'columns'
  }
  return 'rows'
}

/** Cross-axis size of one series bar inside a position (Req 15.11, 16.12). */
export const SERIES_BAR_PX = 14

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

// ---------------------------------------------------------------------------
// Granularity-aware chart model (Requirements 13.5, 15, 16.12)
// ---------------------------------------------------------------------------

/** Patterns that tell series apart without colour (Req 16.12). */
export const SERIES_MARKERS = ['solid', 'diagonal', 'dots', 'cross', 'dashed', 'wave'] as const
export type SeriesMarker = (typeof SERIES_MARKERS)[number]

export interface ChartSeries {
  id: string
  label: string
  marker: SeriesMarker
}

/** Goal tick of a Week or Month position (Req 15.9). */
export interface PositionGoal {
  value: Milli
  progressText: string
  status: GoalStatus
}

export interface ChartPositionV2 {
  index: number
  start: LocalDate
  end: LocalDate
  /** Short axis label. */
  label: string
  /**
   * One value per series for drawing; `null` for a future Day without an imported
   * value. Plain numbers (not bigint) so React props stay serialisable; exact
   * amounts are in the labels.
   */
  values: (number | null)[]
  goal: PositionGoal | null
  isFuture: boolean
  isPartlyFuture: boolean
  ariaLabel: string
}

export interface ChartModelV2 {
  title: string
  series: ChartSeries[]
  positions: ChartPositionV2[]
  /** Sum of the first series over the window, formatted for display (Req 15.10). */
  windowTotalText: string
  canGoNext: boolean
  /** Day granularity only: the Effective_Goal of the shown Week/Month, drawn as a reference line (as before). */
  referenceGoal: Milli | null
}

// Compact "28/09" so a Week label fits a 44 px position.
const NUMERIC_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const LONG_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const SHORT_MONTH_FORMAT = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
const RANGE_END_FORMAT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

function bucketLabel(b: Bucket): string {
  if (b.kind === 'day') return String(Number(b.start.slice(8)))
  if (b.kind === 'week') return NUMERIC_DATE_FORMAT.format(toUtcDate(b.start))
  return SHORT_MONTH_FORMAT.format(toUtcDate(b.start))
}

function bucketName(b: Bucket): string {
  if (b.kind === 'day') return fullDate(b.start)
  if (b.kind === 'month') return LONG_MONTH_FORMAT.format(toUtcDate(b.start))
  return `Week ${SHORT_DATE_FORMAT.format(toUtcDate(b.start))} to ${RANGE_END_FORMAT.format(toUtcDate(b.end))}`
}

function windowTitle(buckets: readonly Bucket[]): string {
  const first = buckets[0]
  const last = buckets[buckets.length - 1]
  if (first.kind === 'day') {
    return first.start.slice(0, 7) === last.start.slice(0, 7) && buckets.length > 7
      ? LONG_MONTH_FORMAT.format(toUtcDate(first.start))
      : `${WEEK_RANGE_FORMAT.format(toUtcDate(first.start))} \u2013 ${WEEK_RANGE_FORMAT.format(toUtcDate(last.end))}`
  }
  if (first.kind === 'month') {
    return `${LONG_MONTH_FORMAT.format(toUtcDate(first.start))} \u2013 ${LONG_MONTH_FORMAT.format(toUtcDate(last.start))}`
  }
  return `${WEEK_RANGE_FORMAT.format(toUtcDate(first.start))} \u2013 ${WEEK_RANGE_FORMAT.format(toUtcDate(last.end))}`
}

function positionGoal(
  ds: Dataset,
  activityId: string,
  bucket: Bucket,
  total: Milli,
  today: LocalDate,
  fmt: NumberDisplay,
): PositionGoal | null {
  if (bucket.period === null) return null
  const goal = resolveEffectiveGoal(ds.goalVersions, activityId, bucket.period)
  if (goal === null) return null
  return {
    value: goal,
    progressText: fmt.progress(goalProgressTenths(total, goal)),
    status: goalStatus(total, goal, bucket.period, today),
  }
}

/**
 * Chart model of one Activity for a window and granularity (Req 15). Regular
 * charts always show the raw Daily_Values (ratio 1, Req 16.10). Day granularity
 * keeps the labels of the previous version (Req 17.5).
 */
export function chartModelV2(
  ds: Dataset,
  activityId: string,
  name: string,
  spec: WindowSpec,
  today: LocalDate,
  fmt: NumberDisplay,
): ChartModelV2 {
  const buckets = chartWindow(spec, today)
  let windowTotal = 0n
  const positions = buckets.map((b, index): ChartPositionV2 => {
    const total = bucketTotal(ds, activityId, b)
    const hasEntries = b.days.some((d) => dayEntries(ds, activityId, d).length > 0)
    const value: number | null = b.isFuture && !hasEntries ? null : total
    if (value !== null) windowTotal += BigInt(value)
    const goal = positionGoal(ds, activityId, b, total, today, fmt)
    let ariaLabel: string
    if (b.kind === 'day') {
      ariaLabel = b.isFuture ? futureAriaLabel(b.start, value, fmt) : pastAriaLabel(b.start, total, fmt)
    } else {
      ariaLabel = `${bucketName(b)}: ${fmt.value(total)}`
      if (goal !== null) ariaLabel += `, goal ${fmt.value(goal.value)}, ${goal.progressText}, ${goal.status}`
      if (b.isPartlyFuture) ariaLabel += ', includes future days'
    }
    return {
      index,
      start: b.start,
      end: b.end,
      label: bucketLabel(b),
      values: [value],
      goal,
      isFuture: b.isFuture,
      isPartlyFuture: b.isPartlyFuture,
      ariaLabel,
    }
  })
  return {
    title: windowTitle(buckets),
    series: [{ id: 'value', label: name, marker: 'solid' }],
    positions,
    windowTotalText: fmt.valueBig(windowTotal),
    canGoNext: canGoNext(spec, today),
    referenceGoal:
      spec.granularity === 'day'
        ? resolveEffectiveGoal(
            ds.goalVersions,
            activityId,
            periodOf(spec.anchor, spec.span === 'week' ? 'weekly' : 'monthly'),
          )
        : null,
  }
}

/** Chart model of an Analyser result (Req 16.12, 16.17). */
export function analyserChartModel(
  model: AnalyserModel,
  spec: WindowSpec,
  today: LocalDate,
  fmt: NumberDisplay,
): ChartModelV2 {
  const series: ChartSeries[] = model.series.map((r, i) => ({
    id: r.spec.id,
    label: r.spec.label,
    marker: SERIES_MARKERS[i % SERIES_MARKERS.length],
  }))
  const positions = model.buckets.map((b, index): ChartPositionV2 => {
    const exact = model.series.map((r) => r.values[index] ?? 0n)
    const values = exact.map((v) => Number(v))
    const parts = model.series.map((r, i) => `${r.spec.label} ${fmt.valueBig(exact[i])}`)
    let ariaLabel = `${bucketName(b)}: ${parts.join(', ')}`
    if (b.isFuture) ariaLabel += ', future'
    else if (b.isPartlyFuture) ariaLabel += ', includes future days'
    return {
      index,
      start: b.start,
      end: b.end,
      label: bucketLabel(b),
      values,
      goal: null,
      isFuture: b.isFuture,
      isPartlyFuture: b.isPartlyFuture,
      ariaLabel,
    }
  })
  return {
    title: windowTitle(model.buckets),
    series,
    positions,
    windowTotalText: fmt.valueBig(model.series[0]?.stats.total ?? 0n),
    canGoNext: canGoNext(spec, today),
    referenceGoal: null,
  }
}

/** Pixel scale of a chart axis with a common zero baseline (Req 13.5). */
export interface Scale {
  /** Distance of the zero baseline from the start of the axis. */
  zeroPx: number
  pxPerUnit: number
}

/**
 * One scale for both directions: positive values extend from `zeroPx` towards
 * the end, negative values towards the start; every bar and goal tick fits in
 * `[0, extentPx]`. Without negative values the baseline is the start edge.
 */
export function chartScale(
  values: readonly (number | bigint | null)[],
  goals: readonly number[],
  extentPx: number,
): Scale {
  let positive = 0
  let negative = 0
  for (const raw of values) {
    if (raw === null) continue
    const v = Number(raw)
    if (v > positive) positive = v
    if (-v > negative) negative = -v
  }
  for (const g of goals) if (g > positive) positive = g
  const span = positive + negative
  if (span === 0 || extentPx <= 0) return { zeroPx: 0, pxPerUnit: 0 }
  const pxPerUnit = extentPx / span
  return { zeroPx: negative * pxPerUnit, pxPerUnit }
}
