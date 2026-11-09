/**
 * Core in-memory data model for the Achievement Tracker domain.
 *
 * This module holds the immutable `Dataset` and its constituent types
 * (`Activity`, `DailyValue`, `GoalVersion`, `DailyValueIndex`) together with
 * the small set of pure helpers the design assigns here: an empty-dataset
 * constructor, value lookup (a missing entry reads as 0, Req 3.1), immutable
 * upsert/delete helpers with structural sharing, and `datasetEquals`.
 *
 * No side effects and no I/O.
 *
 * Primitive alias types (`Milli`, `LocalDate`, period keys and `GoalType`) are
 * owned by `decimal.ts` and `calendar.ts` in the design's module layout. They
 * are declared locally here so this module type-checks on its own; they are
 * plain structural aliases (`number` / `string`), identical to the canonical
 * declarations, so nothing changes once the other modules exist.
 */

/** Integer number of thousandths ("milli" units); always a safe integer. Owned by `decimal.ts`. */
export type Milli = number

/** Calendar date in the local time zone, 'YYYY-MM-DD'. Owned by `calendar.ts`. */
export type LocalDate = string

/** ISO week key, 'YYYY-Www', e.g. '2026-W07'. Owned by `calendar.ts`. */
export type WeekKey = string

/** Calendar month key, 'YYYY-MM'. Owned by `calendar.ts`. */
export type MonthKey = string

/** Period discriminator. Owned by `calendar.ts`. */
export type GoalType = 'weekly' | 'monthly'

/** Either a week key or a month key. Owned by `calendar.ts`. */
export type PeriodKey = WeekKey | MonthKey

export interface Activity {
  /** crypto.randomUUID() */
  id: string
  /** trimmed, 1-100 code points */
  name: string
  /** ISO 8601 UTC timestamp */
  createdAt: string
  /** unique, increasing tie-breaker for ordering */
  createdSeq: number
}

export interface DailyValue {
  activityId: string
  /** <= today when recorded by the user; may be later when imported */
  date: LocalDate
  /** integer, DAILY_MIN..DAILY_MAX */
  value: Milli
}

export type GoalVersion =
  | { activityId: string; goalType: GoalType; startPeriod: PeriodKey; kind: 'set'; value: Milli }
  | { activityId: string; goalType: GoalType; startPeriod: PeriodKey; kind: 'removal' }

/** activityId -> (date -> value). A missing entry means 0 (Req 3.1). */
export type DailyValueIndex = ReadonlyMap<string, ReadonlyMap<LocalDate, Milli>>

export interface Dataset {
  activities: readonly Activity[]
  values: DailyValueIndex
  goalVersions: readonly GoalVersion[]
}

/** The empty Data_Set: no Activities, no Daily_Values, no Goal_Versions. */
export function emptyDataset(): Dataset {
  return { activities: [], values: new Map(), goalVersions: [] }
}

/**
 * Daily_Value lookup for one Activity on one Day. A Day with no stored value
 * reads as 0 (Req 3.1).
 */
export function dailyValue(ds: Dataset, activityId: string, date: LocalDate): Milli {
  return ds.values.get(activityId)?.get(date) ?? 0
}

/**
 * Immutable upsert of a Daily_Value. Returns a new index that shares the maps
 * of untouched Activities (structural sharing); exactly one entry exists per
 * (activityId, date) afterwards (Req 3.3).
 */
export function setDailyValue(
  values: DailyValueIndex,
  activityId: string,
  date: LocalDate,
  value: Milli,
): DailyValueIndex {
  const next = new Map(values)
  const activityValues = new Map(next.get(activityId) ?? [])
  activityValues.set(date, value)
  next.set(activityId, activityValues)
  return next
}

/**
 * Immutable removal of a Daily_Value. Returns a new index with structural
 * sharing of untouched Activities; drops the Activity's inner map once it holds
 * no entries.
 */
export function deleteDailyValue(
  values: DailyValueIndex,
  activityId: string,
  date: LocalDate,
): DailyValueIndex {
  const existing = values.get(activityId)
  if (existing === undefined || !existing.has(date)) return values
  const next = new Map(values)
  const activityValues = new Map(existing)
  activityValues.delete(date)
  if (activityValues.size === 0) {
    next.delete(activityId)
  } else {
    next.set(activityId, activityValues)
  }
  return next
}

/**
 * Immutable removal of every Daily_Value of one Activity. Returns a new index
 * with structural sharing of untouched Activities. Used by the delete cascade.
 */
export function deleteActivityValues(values: DailyValueIndex, activityId: string): DailyValueIndex {
  if (!values.has(activityId)) return values
  const next = new Map(values)
  next.delete(activityId)
  return next
}

/** All stored (date, value) entries of one Activity, in no particular order. */
function activityEntries(values: DailyValueIndex, activityId: string): [LocalDate, Milli][] {
  const inner = values.get(activityId)
  return inner === undefined ? [] : [...inner.entries()]
}

function activitiesEqual(a: Activity, b: Activity): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.createdAt === b.createdAt &&
    a.createdSeq === b.createdSeq
  )
}

function goalVersionsEqual(a: GoalVersion, b: GoalVersion): boolean {
  if (
    a.activityId !== b.activityId ||
    a.goalType !== b.goalType ||
    a.startPeriod !== b.startPeriod ||
    a.kind !== b.kind
  ) {
    return false
  }
  if (a.kind === 'set' && b.kind === 'set') return a.value === b.value
  return true
}

function sameValues(a: DailyValueIndex, b: DailyValueIndex): boolean {
  const activityIds = new Set<string>([...a.keys(), ...b.keys()])
  for (const activityId of activityIds) {
    const entriesA = activityEntries(a, activityId)
    const entriesB = activityEntries(b, activityId)
    if (entriesA.length !== entriesB.length) return false
    const mapB = b.get(activityId)
    for (const [date, value] of entriesA) {
      if (mapB?.get(date) !== value) return false
    }
  }
  return true
}

function sameGoalVersions(a: readonly GoalVersion[], b: readonly GoalVersion[]): boolean {
  if (a.length !== b.length) return false
  const unmatched = [...b]
  for (const version of a) {
    const index = unmatched.findIndex((candidate) => goalVersionsEqual(version, candidate))
    if (index === -1) return false
    unmatched.splice(index, 1)
  }
  return true
}

/**
 * Equivalence used by the round-trip properties (Req 9.3, 12.17): the same
 * Activities (all fields, same order), the same stored Daily_Value entries, and
 * the same set of Goal_Versions. Daily_Values are compared exactly because they
 * are integer milli units.
 */
export function datasetEquals(a: Dataset, b: Dataset): boolean {
  if (a.activities.length !== b.activities.length) return false
  for (let i = 0; i < a.activities.length; i += 1) {
    if (!activitiesEqual(a.activities[i], b.activities[i])) return false
  }
  return sameValues(a.values, b.values) && sameGoalVersions(a.goalVersions, b.goalVersions)
}
