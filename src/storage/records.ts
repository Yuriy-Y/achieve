/**
 * On-disk record shapes and the pure mapping between the domain `Dataset` and
 * the records stored in IndexedDB (design: Data Models — Persisted records).
 *
 * Stored values use the `'milli'` integer encoding: a Daily_Value or a `set`
 * Goal_Version `value` is the integer number of thousandths (a `number`), the
 * same encoding `validateDatasetRules(raw, 'milli')` expects on load. (The
 * Backup_File uses the separate `'fixed3'` string encoding; that lives in
 * `backup.ts`, not here.)
 *
 * This module contains only data shapes, the IndexedDB schema constants, and
 * pure conversion helpers. It performs no IndexedDB calls; `IndexedDbStorage`
 * (a later task) uses these helpers and the schema constants to read and write.
 */

import type { Activity, Dataset, DailyValueIndex, GoalVersion } from '../domain/dataset'
import type { GoalType, PeriodKey } from '../domain/calendar'
import type { Milli } from '../domain/decimal'
import type { RawDataset } from '../domain/datasetRules'

// ---------------------------------------------------------------------------
// IndexedDB schema (design: Persistence — IndexedDB schema)
// ---------------------------------------------------------------------------

/** IndexedDB database name. */
export const DB_NAME = 'achievement-tracker'

/** IndexedDB schema version (bumped only by additive, forward-only migrations). */
export const DB_VERSION = 1

/** Object store names. */
export const STORE_META = 'meta'
export const STORE_ACTIVITIES = 'activities'
export const STORE_DAILY_VALUES = 'dailyValues'
export const STORE_GOAL_VERSIONS = 'goalVersions'

/** All object stores, in creation order. */
export const ALL_STORES = [
  STORE_META,
  STORE_ACTIVITIES,
  STORE_DAILY_VALUES,
  STORE_GOAL_VERSIONS,
] as const

/** The three data stores cleared and rewritten by a `replaceAll`/discard. */
export const DATA_STORES = [STORE_ACTIVITIES, STORE_DAILY_VALUES, STORE_GOAL_VERSIONS] as const

/** Key paths per store (compound keys enforce the one-per-key invariants I3). */
export const KEY_PATHS = {
  [STORE_META]: 'key',
  [STORE_ACTIVITIES]: 'id',
  [STORE_DAILY_VALUES]: ['activityId', 'date'],
  [STORE_GOAL_VERSIONS]: ['activityId', 'goalType', 'startPeriod'],
} as const

/** The single `meta` record identifying the schema version. */
export const META_KEY = 'schema'

/** The `meta` record written on create, `replaceAll` and discard. */
export interface MetaRecord {
  key: typeof META_KEY
  version: number
}

/** The current `meta` record for this schema version. */
export function schemaMetaRecord(): MetaRecord {
  return { key: META_KEY, version: DB_VERSION }
}

// ---------------------------------------------------------------------------
// Persisted record shapes (design: Data Models — Persisted records)
// ---------------------------------------------------------------------------

/** An Activity as stored; same shape as the domain `Activity`. */
export interface ActivityRecord {
  id: string
  name: string
  /** ISO 8601 UTC timestamp. */
  createdAt: string
  createdSeq: number
}

/** A Daily_Value as stored. `value` is the milli integer encoding. */
export interface DailyValueRecord {
  activityId: string
  date: string
  /** Integer number of thousandths (`'milli'` encoding). */
  value: number
}

/** A Goal_Version as stored. `value` is present only when `kind === 'set'`. */
export interface GoalVersionRecord {
  activityId: string
  goalType: GoalType
  startPeriod: PeriodKey
  kind: 'set' | 'removal'
  /** Integer number of thousandths; present only for `set` versions. */
  value?: number
}

// ---------------------------------------------------------------------------
// Dataset -> records
// ---------------------------------------------------------------------------

/** One Activity record. */
function activityToRecord(activity: Activity): ActivityRecord {
  return {
    id: activity.id,
    name: activity.name,
    createdAt: activity.createdAt,
    createdSeq: activity.createdSeq,
  }
}

/** One Goal_Version record; `value` only for `set` versions. */
function goalVersionToRecord(version: GoalVersion): GoalVersionRecord {
  if (version.kind === 'set') {
    return {
      activityId: version.activityId,
      goalType: version.goalType,
      startPeriod: version.startPeriod,
      kind: 'set',
      value: version.value,
    }
  }
  return {
    activityId: version.activityId,
    goalType: version.goalType,
    startPeriod: version.startPeriod,
    kind: 'removal',
  }
}

/** Flatten the Daily_Value index into one record per stored entry. */
function dailyValueRecords(values: DailyValueIndex): DailyValueRecord[] {
  const records: DailyValueRecord[] = []
  for (const [activityId, byDate] of values) {
    for (const [date, value] of byDate) {
      records.push({ activityId, date, value })
    }
  }
  return records
}

/** The records a `Dataset` maps to, grouped per object store. */
export interface DatasetRecords {
  activities: ActivityRecord[]
  dailyValues: DailyValueRecord[]
  goalVersions: GoalVersionRecord[]
}

/**
 * Convert a domain `Dataset` to the records to persist (`'milli'` encoding).
 * Pure; the caller writes each group to its object store.
 */
export function datasetToRecords(ds: Dataset): DatasetRecords {
  return {
    activities: ds.activities.map(activityToRecord),
    dailyValues: dailyValueRecords(ds.values),
    goalVersions: ds.goalVersions.map(goalVersionToRecord),
  }
}

// ---------------------------------------------------------------------------
// Records -> dataset
// ---------------------------------------------------------------------------

/**
 * Convert raw records read from IndexedDB into a validated `Dataset`.
 *
 * Records are untyped on the way in (anything may be in the stored data), so
 * this delegates to `validateDatasetRules(raw, 'milli')` — the shared rule set
 * the design assigns for load validation — which returns either a well-formed
 * immutable `Dataset` or the first rule violation. Load uses the `'milli'`
 * codec because stored values are integer thousandths.
 *
 * `IndexedDbStorage.load` passes the `getAll()` results of the three data
 * stores here; any violation (or an open/read failure handled by the caller)
 * becomes the `unreadable` load outcome (Req 9.4). Re-exported through
 * `datasetRules` so storage callers get the validator and its types from one
 * place.
 */
export { validateDatasetRules } from '../domain/datasetRules'
export type { RawDataset, RuleViolation, ValueCodec } from '../domain/datasetRules'

/**
 * Assemble a `RawDataset` from the three stores' records for validation. The
 * records are passed through as `unknown[]` because the stored data is
 * untrusted until `validateDatasetRules` checks it.
 */
export function toRawDataset(
  activities: unknown[],
  dailyValues: unknown[],
  goalVersions: unknown[],
): RawDataset {
  return { activities, dailyValues, goalVersions }
}

/** The milli encoding used by this module's records (load/commit codec). */
export const LOAD_VALUE_CODEC = 'milli' as const

// Re-export the record value type for callers that annotate milli integers.
export type { Milli }
