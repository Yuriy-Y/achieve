/**
 * Shared Data_Set integrity rules for the Achievement Tracker.
 *
 * One rule set serves two callers (design: "Domain: datasetRules.ts"):
 *   - IndexedDB load, with the `'milli'` codec, where Daily_Value and
 *     Goal_Version values are integer milli units (a `number`);
 *   - Backup_File import, with the `'fixed3'` codec, where values are strict
 *     three-decimal strings (Req 12.1).
 *
 * `validateDatasetRules` takes a `RawDataset` of untyped records (as read from
 * storage or parsed from JSON) and either returns a well-formed immutable
 * `Dataset` or the first rule violation found, reported with a JSON-style path
 * and a short reason (e.g. `dailyValues[12].value: more than 3 decimal places`
 * or `activities[3].name: duplicate of activities[1]`). This backs load failure
 * detection (Req 9.4) and import validation (Req 12.8, 12.9); the first problem
 * found is the one reported.
 *
 * Rules (design "Domain: datasetRules.ts", invariants I1-I5):
 *   - Activity: non-empty string `id`, unique; `name` already trimmed, 1-100
 *     code points, unique case-insensitively; `createdAt` valid ISO 8601;
 *     `createdSeq` safe integer, unique.
 *   - Daily_Value: references a contained Activity; valid `LocalDate`; value in
 *     DAILY_MIN..DAILY_MAX with at most 3 decimals; at most one per
 *     (activityId, date). Dates after today are accepted (Req 12.21).
 *   - Goal_Version: references a contained Activity; `goalType` is `weekly` or
 *     `monthly`; `startPeriod` valid for its type; `kind` is `set` with a value
 *     in GOAL_MIN..GOAL_MAX or `removal` without a value; at most one per
 *     (activityId, goalType, startPeriod).
 *
 * Every record must carry exactly the expected fields; unknown extra fields and
 * missing fields are both rejected (so a file from a newer format is never
 * half-imported). Every function here is pure and does no I/O.
 */

import {
  isValidLocalDate,
  isValidPeriodKey,
  type GoalType,
  type LocalDate,
  type PeriodKey,
} from './calendar'
import { DAILY_MAX, DAILY_MIN, GOAL_MAX, GOAL_MIN, parseFixed3, type Milli } from './decimal'
import type { Activity, Dataset, DailyValue, GoalVersion } from './dataset'
import { setDailyValue } from './dataset'
import { validateActivityName } from './names'
import { err, ok, type Result } from './result'

/** Untyped records as read from IndexedDB or parsed from a Backup_File. */
export interface RawDataset {
  activities: unknown[]
  dailyValues: unknown[]
  goalVersions: unknown[]
}

/** How a Daily_Value / Goal_Version `value` field is encoded in the source. */
export type ValueCodec = 'milli' | 'fixed3'

/** A single rule violation, naming the offending path and a short reason. */
export interface RuleViolation {
  problem: string
}

/** Expected own-field name sets; records may carry exactly these and no more. */
const ACTIVITY_FIELDS = ['id', 'name', 'createdAt', 'createdSeq'] as const
const DAILY_VALUE_FIELDS = ['activityId', 'date', 'value'] as const
const GOAL_SET_FIELDS = ['activityId', 'goalType', 'startPeriod', 'kind', 'value'] as const
const GOAL_REMOVAL_FIELDS = ['activityId', 'goalType', 'startPeriod', 'kind'] as const

/** ISO 8601 UTC timestamp as produced by `Date.prototype.toISOString`. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** A plain (non-null, non-array) object record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Fail unless `record` has exactly the `expected` own enumerable keys: every
 * expected key present and no extra key. Returns a problem for the first key
 * difference found (missing before unexpected), or `null` when the sets match.
 */
function checkExactFields(
  record: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): string | null {
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return `${path}: missing field ${key}`
    }
  }
  for (const key of Object.keys(record)) {
    if (!expected.includes(key)) {
      return `${path}: unexpected field ${key}`
    }
  }
  return null
}

/** True when `value` is a syntactically valid ISO 8601 UTC timestamp string. */
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_RE.test(value)) return false
  const ms = Date.parse(value)
  return !Number.isNaN(ms)
}

/**
 * Validate and decode a `value` field against the codec and the given milli
 * range. `'milli'` expects an integer `number`; `'fixed3'` expects a strict
 * three-decimal string (`parseFixed3`). Returns the decoded milli integer or a
 * reason string describing the first problem.
 */
function decodeValue(
  raw: unknown,
  codec: ValueCodec,
  min: Milli,
  max: Milli,
): Result<Milli, string> {
  let value: Milli
  if (codec === 'milli') {
    if (typeof raw !== 'number' || !Number.isInteger(raw)) {
      return err('value must be an integer number of thousandths')
    }
    value = raw
  } else {
    if (typeof raw !== 'string') {
      return err('value must be a 3-decimal string')
    }
    const parsed = parseFixed3(raw)
    if (!parsed.ok) {
      return err('value is not a valid 3-decimal number')
    }
    value = parsed.value
  }
  if (value < min || value > max) {
    return err('value out of range')
  }
  return ok(value)
}

/**
 * Validate the Activities of a RawDataset, in order. Builds the typed list,
 * and the set of ids used by Daily_Value and Goal_Version reference checks.
 * Enforces unique id, unique createdSeq and case-insensitive unique name (via
 * `validateActivityName`), exact field set, trimmed 1-100 code-point name, ISO
 * `createdAt` and safe-integer `createdSeq`.
 */
function validateActivities(
  rawActivities: unknown[],
): Result<{ activities: Activity[]; ids: Set<string> }, RuleViolation> {
  const activities: Activity[] = []
  const ids = new Set<string>()
  const seqs = new Set<number>()

  for (let i = 0; i < rawActivities.length; i += 1) {
    const path = `activities[${i}]`
    const raw = rawActivities[i]
    if (!isRecord(raw)) {
      return err({ problem: `${path}: not an object` })
    }
    const fieldProblem = checkExactFields(raw, ACTIVITY_FIELDS, path)
    if (fieldProblem !== null) return err({ problem: fieldProblem })

    const { id, name, createdAt, createdSeq } = raw

    if (typeof id !== 'string' || id.length === 0) {
      return err({ problem: `${path}.id: must be a non-empty string` })
    }
    if (ids.has(id)) {
      return err({ problem: `${path}.id: duplicate` })
    }

    if (typeof name !== 'string') {
      return err({ problem: `${path}.name: must be a string` })
    }
    if (name !== name.trim()) {
      return err({ problem: `${path}.name: must be trimmed` })
    }
    // `required`, `tooLong` and case-insensitive `duplicate` against the
    // Activities validated so far (design reuses `validateActivityName`).
    const nameResult = validateActivityName(name, activities)
    if (!nameResult.ok) {
      if (nameResult.error === 'required') {
        return err({ problem: `${path}.name: required` })
      }
      if (nameResult.error === 'tooLong') {
        return err({ problem: `${path}.name: more than 100 characters` })
      }
      const duplicateOf = activities.findIndex(
        (existing) => existing.name.toLocaleLowerCase('en') === name.toLocaleLowerCase('en'),
      )
      return err({ problem: `${path}.name: duplicate of activities[${duplicateOf}]` })
    }

    if (!isIsoTimestamp(createdAt)) {
      return err({ problem: `${path}.createdAt: must be an ISO 8601 UTC timestamp` })
    }

    if (typeof createdSeq !== 'number' || !Number.isSafeInteger(createdSeq)) {
      return err({ problem: `${path}.createdSeq: must be a safe integer` })
    }
    if (seqs.has(createdSeq)) {
      return err({ problem: `${path}.createdSeq: duplicate` })
    }

    ids.add(id)
    seqs.add(createdSeq)
    activities.push({ id, name, createdAt, createdSeq })
  }

  return ok({ activities, ids })
}

/**
 * Validate the Daily_Values of a RawDataset, in order. Enforces exact field
 * set, reference to a contained Activity, valid LocalDate (dates after today
 * are accepted, Req 12.21), decoded value in range with at most 3 decimals, and
 * at most one value per (activityId, date). Returns the Daily_Value index.
 */
function validateDailyValues(
  rawDailyValues: unknown[],
  activityIds: Set<string>,
  codec: ValueCodec,
): Result<DailyValue[], RuleViolation> {
  const dailyValues: DailyValue[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < rawDailyValues.length; i += 1) {
    const path = `dailyValues[${i}]`
    const raw = rawDailyValues[i]
    if (!isRecord(raw)) {
      return err({ problem: `${path}: not an object` })
    }
    const fieldProblem = checkExactFields(raw, DAILY_VALUE_FIELDS, path)
    if (fieldProblem !== null) return err({ problem: fieldProblem })

    const { activityId, date, value } = raw

    if (typeof activityId !== 'string' || !activityIds.has(activityId)) {
      return err({ problem: `${path}.activityId: references an unknown activity` })
    }

    if (typeof date !== 'string' || !isValidLocalDate(date)) {
      return err({ problem: `${path}.date: must be a valid YYYY-MM-DD date` })
    }

    const decoded = decodeValue(value, codec, DAILY_MIN, DAILY_MAX)
    if (!decoded.ok) {
      return err({ problem: `${path}.value: ${decoded.error}` })
    }

    const key = `${activityId}\u0000${date}`
    if (seenKeys.has(key)) {
      return err({ problem: `${path}: duplicate daily value for (activityId, date)` })
    }
    seenKeys.add(key)

    dailyValues.push({ activityId, date: date as LocalDate, value: decoded.value })
  }

  return ok(dailyValues)
}

/**
 * Validate the Goal_Versions of a RawDataset, in order. Enforces exact field
 * set (depending on `kind`), reference to a contained Activity, `weekly`/
 * `monthly` goal type, a `startPeriod` valid for that type, a `set` value in
 * range (or no value for a `removal`), and at most one version per
 * (activityId, goalType, startPeriod).
 */
function validateGoalVersions(
  rawGoalVersions: unknown[],
  activityIds: Set<string>,
  codec: ValueCodec,
): Result<GoalVersion[], RuleViolation> {
  const goalVersions: GoalVersion[] = []
  const seenKeys = new Set<string>()

  for (let i = 0; i < rawGoalVersions.length; i += 1) {
    const path = `goalVersions[${i}]`
    const raw = rawGoalVersions[i]
    if (!isRecord(raw)) {
      return err({ problem: `${path}: not an object` })
    }

    const { activityId, goalType, startPeriod, kind } = raw

    if (kind !== 'set' && kind !== 'removal') {
      return err({ problem: `${path}.kind: must be "set" or "removal"` })
    }

    const expectedFields = kind === 'set' ? GOAL_SET_FIELDS : GOAL_REMOVAL_FIELDS
    const fieldProblem = checkExactFields(raw, expectedFields, path)
    if (fieldProblem !== null) return err({ problem: fieldProblem })

    if (typeof activityId !== 'string' || !activityIds.has(activityId)) {
      return err({ problem: `${path}.activityId: references an unknown activity` })
    }

    if (goalType !== 'weekly' && goalType !== 'monthly') {
      return err({ problem: `${path}.goalType: must be "weekly" or "monthly"` })
    }

    if (typeof startPeriod !== 'string' || !isValidPeriodKey(goalType, startPeriod)) {
      return err({ problem: `${path}.startPeriod: invalid for ${goalType} goal` })
    }

    const key = `${activityId}\u0000${goalType}\u0000${startPeriod}`
    if (seenKeys.has(key)) {
      return err({
        problem: `${path}: duplicate goal version for (activityId, goalType, startPeriod)`,
      })
    }
    seenKeys.add(key)

    if (kind === 'set') {
      const decoded = decodeValue(raw.value, codec, GOAL_MIN, GOAL_MAX)
      if (!decoded.ok) {
        return err({ problem: `${path}.value: ${decoded.error}` })
      }
      goalVersions.push({
        activityId,
        goalType: goalType as GoalType,
        startPeriod: startPeriod as PeriodKey,
        kind: 'set',
        value: decoded.value,
      })
    } else {
      goalVersions.push({
        activityId,
        goalType: goalType as GoalType,
        startPeriod: startPeriod as PeriodKey,
        kind: 'removal',
      })
    }
  }

  return ok(goalVersions)
}

/**
 * Validate a RawDataset against the shared integrity rules and, on success,
 * build the immutable `Dataset`. Checks run in record order (Activities, then
 * Daily_Values, then Goal_Versions) and stop at the first violation, so load
 * (Req 9.4) and import (Req 12.8, 12.9) both report the first problem found.
 *
 * @param raw        Untyped records read from storage or parsed from JSON.
 * @param valueCodec `'milli'` for integer-encoded values (load), `'fixed3'` for
 *                   three-decimal string values (Backup_File import).
 */
export function validateDatasetRules(
  raw: RawDataset,
  valueCodec: ValueCodec,
): Result<Dataset, RuleViolation> {
  if (!Array.isArray(raw.activities)) {
    return err({ problem: 'activities: must be an array' })
  }
  if (!Array.isArray(raw.dailyValues)) {
    return err({ problem: 'dailyValues: must be an array' })
  }
  if (!Array.isArray(raw.goalVersions)) {
    return err({ problem: 'goalVersions: must be an array' })
  }

  const activitiesResult = validateActivities(raw.activities)
  if (!activitiesResult.ok) return err(activitiesResult.error)
  const { activities, ids } = activitiesResult.value

  const dailyValuesResult = validateDailyValues(raw.dailyValues, ids, valueCodec)
  if (!dailyValuesResult.ok) return err(dailyValuesResult.error)

  const goalVersionsResult = validateGoalVersions(raw.goalVersions, ids, valueCodec)
  if (!goalVersionsResult.ok) return err(goalVersionsResult.error)

  // Build the immutable Daily_Value index with structural-sharing helpers.
  let values = new Map() as Dataset['values']
  for (const dv of dailyValuesResult.value) {
    values = setDailyValue(values, dv.activityId, dv.date, dv.value)
  }

  return ok({
    activities,
    values,
    goalVersions: goalVersionsResult.value,
  })
}
