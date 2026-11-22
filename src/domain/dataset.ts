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

/**
 * A tagged Daily_Entry (Req 14): the value of one Activity on one Day for a
 * non-empty Tag_Combination. The untagged entry is the legacy `DailyValue`.
 * `tags` holds 1-3 canonical spellings in the order the user attached them.
 */
export interface TaggedValue {
  activityId: string
  date: LocalDate
  tags: readonly string[]
  /** integer, DAILY_MIN..DAILY_MAX */
  value: Milli
}

/** activityId -> date -> comboKey -> tagged entry. */
export type TaggedIndex = ReadonlyMap<string, ReadonlyMap<LocalDate, ReadonlyMap<string, TaggedValue>>>

/** Global Tag_Ratio of one Tag in milli (1..1_000_000); absent means 1.000 (Req 16.8). */
export interface TagRatio {
  /** `tagKey` of the Tag */
  key: string
  /** canonical spelling */
  label: string
  ratio: Milli
}

export interface Dataset {
  activities: readonly Activity[]
  /** Untagged Daily_Entries, exactly the previous version's Daily_Values. */
  values: DailyValueIndex
  /** Tagged Daily_Entries (Req 14). */
  taggedValues: TaggedIndex
  /** Global Tag_Ratios by `tagKey`; only ratios different from 1 are stored. */
  tagRatios: ReadonlyMap<string, TagRatio>
  goalVersions: readonly GoalVersion[]
}

/** The empty Data_Set: no Activities, no entries, no ratios, no Goal_Versions. */
export function emptyDataset(): Dataset {
  return {
    activities: [],
    values: new Map(),
    taggedValues: new Map(),
    tagRatios: new Map(),
    goalVersions: [],
  }
}

/** One Daily_Entry of a Day as shown to the user: tags empty for the untagged entry. */
export interface EntryView {
  tags: readonly string[]
  value: Milli
}

/**
 * Day_Total: the untagged value plus every tagged entry of one Activity on one
 * Day (Req 14.16). A Day without entries reads as 0 (Req 3.1).
 */
export function dayTotal(
  ds: Pick<Dataset, 'values' | 'taggedValues'>,
  activityId: string,
  date: LocalDate,
): Milli {
  let total = ds.values.get(activityId)?.get(date) ?? 0
  const tagged = ds.taggedValues.get(activityId)?.get(date)
  if (tagged !== undefined) for (const entry of tagged.values()) total += entry.value
  return total
}

/**
 * The Day's entries: the untagged entry first (only when stored), then tagged
 * entries in `comboKey` order, so the list is stable.
 */
export function dayEntries(
  ds: Pick<Dataset, 'values' | 'taggedValues'>,
  activityId: string,
  date: LocalDate,
): EntryView[] {
  const out: EntryView[] = []
  const untagged = ds.values.get(activityId)?.get(date)
  if (untagged !== undefined) out.push({ tags: [], value: untagged })
  const tagged = ds.taggedValues.get(activityId)?.get(date)
  if (tagged !== undefined) {
    for (const key of [...tagged.keys()].sort()) {
      const entry = tagged.get(key)
      if (entry !== undefined) out.push({ tags: entry.tags, value: entry.value })
    }
  }
  return out
}

/** Immutable upsert of a tagged entry under its `comboKey`. */
export function setTaggedValue(index: TaggedIndex, entry: TaggedValue, comboKey: string): TaggedIndex {
  const next = new Map(index)
  const byDate = new Map(next.get(entry.activityId) ?? [])
  const byCombo = new Map(byDate.get(entry.date) ?? [])
  byCombo.set(comboKey, entry)
  byDate.set(entry.date, byCombo)
  next.set(entry.activityId, byDate)
  return next
}

/** Immutable removal of one tagged entry; prunes emptied inner maps. */
export function deleteTaggedValue(
  index: TaggedIndex,
  activityId: string,
  date: LocalDate,
  comboKey: string,
): TaggedIndex {
  const byCombo = index.get(activityId)?.get(date)
  if (byCombo === undefined || !byCombo.has(comboKey)) return index
  const next = new Map(index)
  const byDate = new Map(index.get(activityId))
  const combos = new Map(byCombo)
  combos.delete(comboKey)
  if (combos.size === 0) byDate.delete(date)
  else byDate.set(date, combos)
  if (byDate.size === 0) next.delete(activityId)
  else next.set(activityId, byDate)
  return next
}

/** Removes every tagged entry of one Activity (delete cascade, Req 1.9). */
export function deleteActivityTagged(index: TaggedIndex, activityId: string): TaggedIndex {
  if (!index.has(activityId)) return index
  const next = new Map(index)
  next.delete(activityId)
  return next
}

/** All tagged entries as a flat list (activity, date, comboKey order is not significant). */
export function allTaggedValues(index: TaggedIndex): { entry: TaggedValue; comboKey: string }[] {
  const out: { entry: TaggedValue; comboKey: string }[] = []
  for (const byDate of index.values())
    for (const byCombo of byDate.values())
      for (const [comboKey, entry] of byCombo) out.push({ entry, comboKey })
  return out
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
 * Activities (all fields, same order), the same stored Daily_Value entries, the same
 * tagged entries (tags compared in order) and Tag_Ratios, and the same set of Goal_Versions. Daily_Values are compared exactly because they
 * are integer milli units.
 */
function sameTagged(a: TaggedIndex, b: TaggedIndex): boolean {
  const listA = allTaggedValues(a)
  const listB = allTaggedValues(b)
  if (listA.length !== listB.length) return false
  for (const { entry, comboKey } of listA) {
    const other = b.get(entry.activityId)?.get(entry.date)?.get(comboKey)
    if (other === undefined || other.value !== entry.value) return false
    if (other.tags.length !== entry.tags.length) return false
    if (other.tags.some((tag, i) => tag !== entry.tags[i])) return false
  }
  return true
}

function sameRatios(a: ReadonlyMap<string, TagRatio>, b: ReadonlyMap<string, TagRatio>): boolean {
  if (a.size !== b.size) return false
  for (const [key, ra] of a) {
    const rb = b.get(key)
    if (rb === undefined || rb.ratio !== ra.ratio || rb.label !== ra.label) return false
  }
  return true
}

export function datasetEquals(a: Dataset, b: Dataset): boolean {
  if (a.activities.length !== b.activities.length) return false
  for (let i = 0; i < a.activities.length; i += 1) {
    if (!activitiesEqual(a.activities[i], b.activities[i])) return false
  }
  return (
    sameValues(a.values, b.values) &&
    sameTagged(a.taggedValues, b.taggedValues) &&
    sameRatios(a.tagRatios, b.tagRatios) &&
    sameGoalVersions(a.goalVersions, b.goalVersions)
  )
}
