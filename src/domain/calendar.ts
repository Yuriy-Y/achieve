/**
 * Local-calendar date and Period logic for the Achievement Tracker.
 *
 * Every function here is pure and free of time-zone drift: a `LocalDate` is the
 * calendar date in the user's local zone as a `YYYY-MM-DD` string, and all date
 * arithmetic is done on UTC day numbers (`Date.UTC(...) / 86_400_000`) so that
 * daylight-saving changes never shift a result (design: Clock and date changes,
 * Domain: calendar.ts). "Today" is the only value read from the local clock.
 *
 * A Week runs Monday to Sunday and is identified by its ISO 8601 week-year and
 * week number (`YYYY-Www`); a Month is a calendar month (`YYYY-MM`). Keys are
 * zero-padded so lexicographic order matches chronological order within a type.
 */

/** Calendar date in the local zone, formatted `YYYY-MM-DD`. */
export type LocalDate = string
/** ISO 8601 week key, formatted `YYYY-Www` (e.g. `2026-W07`). */
export type WeekKey = string
/** Calendar month key, formatted `YYYY-MM`. */
export type MonthKey = string
/** The two kinds of Period the Tracker supports. */
export type GoalType = 'weekly' | 'monthly'
/** A Period key is either a WeekKey or a MonthKey, depending on the Period type. */
export type PeriodKey = WeekKey | MonthKey
/** A Period: a Week or a Month, identified by its key. */
export interface Period {
  type: GoalType
  key: PeriodKey
}

const MS_PER_DAY = 86_400_000

const LOCAL_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const WEEK_KEY_RE = /^(\d{4})-W(\d{2})$/
const MONTH_KEY_RE = /^(\d{4})-(\d{2})$/

/** Zero-pad a non-negative integer to the given width. */
function pad(value: number, width: number): string {
  return String(value).padStart(width, '0')
}

/**
 * Today's LocalDate from a clock value, using the local-zone calendar fields.
 * `now` is normally `new Date()`; passing it in keeps the function pure/testable.
 */
export function todayLocal(now: Date): LocalDate {
  return `${pad(now.getFullYear(), 4)}-${pad(now.getMonth() + 1, 2)}-${pad(now.getDate(), 2)}`
}

/** True when `s` is a syntactically valid and real calendar date `YYYY-MM-DD`. */
export function isValidLocalDate(s: string): boolean {
  const m = LOCAL_DATE_RE.exec(s)
  if (m === null) return false
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12) return false
  if (day < 1 || day > daysInMonth(year, month)) return false
  return true
}

/** Number of days in a given 1-based month of a year (handles leap Februaries). */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** True when `year` is a Gregorian leap year. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** UTC day number (days since the Unix epoch) for a valid LocalDate. */
function toDayNumber(date: LocalDate): number {
  const m = LOCAL_DATE_RE.exec(date)
  if (m === null) throw new Error(`Invalid LocalDate: ${date}`)
  const utcMs = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Math.round(utcMs / MS_PER_DAY)
}

/** LocalDate for a UTC day number. */
function fromDayNumber(dayNumber: number): LocalDate {
  const d = new Date(dayNumber * MS_PER_DAY)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}`
}

/** Add `n` days (which may be negative) to a LocalDate. */
export function addDays(date: LocalDate, n: number): LocalDate {
  return fromDayNumber(toDayNumber(date) + n)
}

/** Compare two LocalDates chronologically: negative, 0 or positive. */
export function compareDates(a: LocalDate, b: LocalDate): number {
  return toDayNumber(a) - toDayNumber(b)
}

/**
 * ISO weekday, Monday = 1 ... Sunday = 7, for a UTC day number.
 * The Unix epoch (day 0, 1970-01-01) was a Thursday (JS getUTCDay === 4).
 */
function isoWeekday(dayNumber: number): number {
  const jsDay = new Date(dayNumber * MS_PER_DAY).getUTCDay() // 0 (Sun) .. 6 (Sat)
  return jsDay === 0 ? 7 : jsDay
}

/**
 * ISO 8601 week-year and week number for a LocalDate. The ISO week-year is the
 * year that owns the Thursday of the date's week, so `2025-12-29` is in
 * `2026-W01` and `2027-01-01` is in `2026-W53`.
 */
function isoWeekParts(date: LocalDate): { weekYear: number; week: number } {
  const dayNumber = toDayNumber(date)
  // The Thursday of this date's week determines the ISO week-year.
  const thursday = dayNumber + (4 - isoWeekday(dayNumber))
  const weekYear = new Date(thursday * MS_PER_DAY).getUTCFullYear()
  // Day number of the first Thursday's week's Monday = week 1's Monday.
  const jan4 = toDayNumber(`${pad(weekYear, 4)}-01-04`)
  const week1Monday = jan4 - (isoWeekday(jan4) - 1)
  const week = Math.floor((dayNumber - week1Monday) / 7) + 1
  return { weekYear, week }
}

/** Number of ISO weeks (52 or 53) in a given ISO week-year. */
function isoWeeksInYear(weekYear: number): number {
  // A year has 53 ISO weeks iff 1 January is a Thursday, or it is a leap year
  // whose 1 January is a Wednesday.
  const jan1 = toDayNumber(`${pad(weekYear, 4)}-01-01`)
  const weekday = isoWeekday(jan1)
  if (weekday === 4) return 53
  if (weekday === 3 && isLeapYear(weekYear)) return 53
  return 52
}

/** True when `key` is a valid key for the given Period type. */
export function isValidPeriodKey(type: GoalType, key: string): boolean {
  if (type === 'monthly') {
    const m = MONTH_KEY_RE.exec(key)
    if (m === null) return false
    const month = Number(m[2])
    return month >= 1 && month <= 12
  }
  const m = WEEK_KEY_RE.exec(key)
  if (m === null) return false
  const weekYear = Number(m[1])
  const week = Number(m[2])
  if (week < 1) return false
  return week <= isoWeeksInYear(weekYear)
}

/** The ISO WeekKey containing a LocalDate. */
function weekKeyOf(date: LocalDate): WeekKey {
  const { weekYear, week } = isoWeekParts(date)
  return `${pad(weekYear, 4)}-W${pad(week, 2)}`
}

/** The MonthKey containing a LocalDate. */
function monthKeyOf(date: LocalDate): MonthKey {
  return date.slice(0, 7)
}

/** The Period of the given type that contains a LocalDate. */
export function periodOf(date: LocalDate, type: GoalType): Period {
  return type === 'weekly'
    ? { type, key: weekKeyOf(date) }
    : { type, key: monthKeyOf(date) }
}

/** First Day of a Period: the Monday of a Week, or the 1st of a Month. */
export function periodStart(p: Period): LocalDate {
  if (p.type === 'monthly') {
    const m = MONTH_KEY_RE.exec(p.key)
    if (m === null) throw new Error(`Invalid MonthKey: ${p.key}`)
    return `${m[1]}-${m[2]}-01`
  }
  const m = WEEK_KEY_RE.exec(p.key)
  if (m === null) throw new Error(`Invalid WeekKey: ${p.key}`)
  const weekYear = Number(m[1])
  const week = Number(m[2])
  const jan4 = toDayNumber(`${pad(weekYear, 4)}-01-04`)
  const week1Monday = jan4 - (isoWeekday(jan4) - 1)
  return fromDayNumber(week1Monday + (week - 1) * 7)
}

/** Last Day of a Period: the Sunday of a Week, or the last day of a Month. */
export function periodEnd(p: Period): LocalDate {
  if (p.type === 'monthly') {
    const m = MONTH_KEY_RE.exec(p.key)
    if (m === null) throw new Error(`Invalid MonthKey: ${p.key}`)
    const year = Number(m[1])
    const month = Number(m[2])
    return `${m[1]}-${m[2]}-${pad(daysInMonth(year, month), 2)}`
  }
  return addDays(periodStart(p), 6)
}

/** All Days of a Period in ascending order (7 for a Week, 28-31 for a Month). */
export function daysOf(p: Period): LocalDate[] {
  const start = toDayNumber(periodStart(p))
  const end = toDayNumber(periodEnd(p))
  const days: LocalDate[] = []
  for (let n = start; n <= end; n++) {
    days.push(fromDayNumber(n))
  }
  return days
}

/** The Period of the same type immediately after `p`. */
export function nextPeriod(p: Period): Period {
  const afterEnd = addDays(periodEnd(p), 1)
  return periodOf(afterEnd, p.type)
}

/** The Period of the same type immediately before `p`. */
export function prevPeriod(p: Period): Period {
  const beforeStart = addDays(periodStart(p), -1)
  return periodOf(beforeStart, p.type)
}

/** Compare two Periods of the same type chronologically: negative, 0 or positive. */
export function comparePeriods(a: Period, b: Period): number {
  if (a.type !== b.type) {
    throw new Error(`Cannot compare periods of different types: ${a.type} vs ${b.type}`)
  }
  // Keys are zero-padded, so lexicographic order equals chronological order.
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

/** The Current_Period of the given type: the Period containing today. */
export function currentPeriod(today: LocalDate, type: GoalType): Period {
  return periodOf(today, type)
}
