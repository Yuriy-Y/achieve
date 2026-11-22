/**
 * Chart granularity and Chart_Window (Requirements 5, 15). Pure functions.
 *
 * Granularity says what one x-axis position is: a Day, a Week or a Month.
 * Granularity Day shows the selected Week or Month (the `span`), exactly like
 * the previous version. Granularity Week and Month show the 12 consecutive
 * Weeks or Months ending at the selected one. Both Chart_View and the Analyser
 * use these functions.
 */
import {
  addDays,
  compareDates,
  comparePeriods,
  currentPeriod,
  daysOf,
  periodEnd,
  periodOf,
  periodStart,
  nextPeriod,
  prevPeriod,
  type GoalType,
  type LocalDate,
  type Period,
} from './calendar'
import { dayTotal, type Dataset } from './dataset'
import type { Milli } from './decimal'

export type Granularity = 'day' | 'week' | 'month'
/** Window length of Day granularity: the selected Week or Month. */
export type Span = 'week' | 'month'

/** Number of positions of Week and Month granularity (Req 15.3, 15.4). */
export const BUCKET_WINDOW = 12

/** `anchor` is a LocalDate inside the LAST position of the window. */
export interface WindowSpec {
  granularity: Granularity
  span: Span
  anchor: LocalDate
}

export interface Bucket {
  kind: Granularity
  start: LocalDate
  /** Inclusive. */
  end: LocalDate
  days: LocalDate[]
  /** The whole bucket lies after today. */
  isFuture: boolean
  /** The bucket starts on or before today and ends after it (Req 15.12). */
  isPartlyFuture: boolean
  /** The Week or Month Period; `null` for a Day bucket. */
  period: Period | null
}

const spanType = (span: Span): GoalType => (span === 'week' ? 'weekly' : 'monthly')
const bucketType = (g: 'week' | 'month'): GoalType => (g === 'week' ? 'weekly' : 'monthly')

/** The default window: Day granularity, Span Week, the current Week (Req 15.5, 17.5). */
export function defaultWindow(today: LocalDate): WindowSpec {
  return { granularity: 'day', span: 'week', anchor: today }
}

function periodBucket(p: Period, today: LocalDate): Bucket {
  const start = periodStart(p)
  const end = periodEnd(p)
  return {
    kind: p.type === 'weekly' ? 'week' : 'month',
    start,
    end,
    days: daysOf(p),
    isFuture: compareDates(start, today) > 0,
    isPartlyFuture: compareDates(start, today) <= 0 && compareDates(end, today) > 0,
    period: p,
  }
}

/** The ordered positions of a window (Req 5.1, 5.2, 15.3, 15.4). */
export function chartWindow(spec: WindowSpec, today: LocalDate): Bucket[] {
  if (spec.granularity === 'day') {
    return daysOf(periodOf(spec.anchor, spanType(spec.span))).map((day) => ({
      kind: 'day' as const,
      start: day,
      end: day,
      days: [day],
      isFuture: compareDates(day, today) > 0,
      isPartlyFuture: false,
      period: null,
    }))
  }
  const type = bucketType(spec.granularity)
  const periods: Period[] = [periodOf(spec.anchor, type)]
  while (periods.length < BUCKET_WINDOW) periods.unshift(prevPeriod(periods[0]))
  return periods.map((p) => periodBucket(p, today))
}

/** The Period that holds the last position of the window. */
function lastPeriod(spec: WindowSpec): Period {
  return periodOf(spec.anchor, spec.granularity === 'day' ? spanType(spec.span) : bucketType(spec.granularity))
}

/** `false` exactly when the last position is the Current_Period (Req 5.10, 15.7). */
export function canGoNext(spec: WindowSpec, today: LocalDate): boolean {
  const last = lastPeriod(spec)
  return comparePeriods(last, currentPeriod(today, last.type)) < 0
}

function shiftMonths(anchor: LocalDate, months: number): LocalDate {
  const [y, m] = periodOf(anchor, 'monthly').key.split('-').map(Number)
  const index = y * 12 + (m - 1) + months
  const year = Math.floor(index / 12)
  const month = (index % 12) + 1
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`
}

/**
 * Move the window by its own length (Req 15.6): one Week or Month for Day
 * granularity, 12 Weeks or 12 Months otherwise. `next` is clamped so the last
 * position never lies after the Current_Period.
 */
export function shiftWindow(spec: WindowSpec, dir: 'prev' | 'next', today: LocalDate): WindowSpec {
  if (dir === 'next' && !canGoNext(spec, today)) return spec
  const sign = dir === 'next' ? 1 : -1
  let anchor: LocalDate
  if (spec.granularity === 'day') {
    const p = lastPeriod(spec)
    anchor = periodStart(dir === 'next' ? nextPeriod(p) : prevPeriod(p))
  } else if (spec.granularity === 'week') {
    anchor = addDays(spec.anchor, sign * 7 * BUCKET_WINDOW)
  } else {
    anchor = shiftMonths(spec.anchor, sign * BUCKET_WINDOW)
  }
  if (dir === 'next') {
    const type = spec.granularity === 'day' ? spanType(spec.span) : bucketType(spec.granularity)
    if (comparePeriods(periodOf(anchor, type), currentPeriod(today, type)) > 0) anchor = today
  }
  return { ...spec, anchor }
}

/**
 * Change the granularity keeping the user at the same point in time (Req 15.8):
 * the new window ends at the position containing the last Day of the previous
 * window, or today when that Day is later than today.
 */
export function switchGranularity(spec: WindowSpec, to: Granularity, today: LocalDate): WindowSpec {
  if (to === spec.granularity) return spec
  const buckets = chartWindow(spec, today)
  const lastDay = buckets[buckets.length - 1].end
  const anchor = compareDates(lastDay, today) > 0 ? today : lastDay
  return { ...spec, granularity: to, anchor }
}

/** Change the Span of Day granularity with the rule of Req 5.11. */
export function switchSpan(spec: WindowSpec, to: Span, today: LocalDate): WindowSpec {
  if (to === spec.span) return spec
  const selected = periodOf(spec.anchor, spanType(spec.span))
  const current = currentPeriod(today, selected.type)
  const next =
    comparePeriods(selected, current) === 0
      ? currentPeriod(today, spanType(to))
      : periodOf(periodStart(selected), spanType(to))
  return { ...spec, span: to, anchor: periodStart(next) }
}

/** Sum of the Day_Totals of one Activity over a bucket, including future-dated values (Req 15.12). */
export function bucketTotal(
  ds: Pick<Dataset, 'values' | 'taggedValues'>,
  activityId: string,
  bucket: Bucket,
): Milli {
  let total = 0
  for (const day of bucket.days) total += dayTotal(ds, activityId, day)
  return total
}
