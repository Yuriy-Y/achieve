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
 *   - Tagged Daily_Entry and Tag_Ratio rules (Req 14.21, 16.8), see `validateTagged`.
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
import {
  DAILY_MAX,
  DAILY_MIN,
  GOAL_MAX,
  GOAL_MIN,
  RATIO_MAX,
  RATIO_MIN,
  parseFixed3,
  type Milli,
} from './decimal'
import type { Activity, Dataset, DailyValue, GoalVersion, TaggedValue, TagRatio } from './dataset'
import { setDailyValue, setTaggedValue } from './dataset'
import { comboKey, tagKey, validateTag, TAGS_PER_ENTRY_MAX } from './tags'
import { validateActivityName } from './names'
import { err, ok, type Result } from './result'

/** Untyped records as read from IndexedDB or parsed from a Backup_File. */
export interface RawDataset {
  activities: unknown[]
  dailyValues: unknown[]
  goalVersions: unknown[]
  /** Tagged Daily_Entries; absent in legacy storage and in Backup format 1. */
  taggedValues?: unknown[]
  /** Global Tag_Ratios; absent in legacy storage and in Backup format 1. */
  tagRatios?: unknown[]
}

/**
 * Which extension features a source may contain.
 * - `allowNegative`: Daily_Values below zero (Backup format 2, storage).
 * - `tagged`: `'forbidden'` (Backup format 1: the lists must be absent),
 *   `'optional'` (storage: absent or empty stores allowed), `'required'`
 *   (Backup format 2: both lists must be present arrays).
 */
export interface RuleOptions {
  allowNegative: boolean
  tagged: 'forbidden' | 'optional' | 'required'
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
  allowNegative = false,
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
    const parsed = parseFixed3(raw, allowNegative)
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
  allowNegative: boolean,
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

    const decoded = decodeValue(value, codec, allowNegative ? DAILY_MIN : 0, DAILY_MAX, allowNegative)
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

const TAGGED_STORE_FIELDS = ['activityId', 'date', 'comboKey', 'tags', 'value'] as const
const TAGGED_FILE_FIELDS = ['activityId', 'date', 'tags', 'value'] as const
const RATIO_STORE_FIELDS = ['key', 'label', 'ratio'] as const
const RATIO_FILE_FIELDS = ['tag', 'ratio'] as const

/**
 * Validate tagged Daily_Entries and Tag_Ratios (Req 14.21, 16.8, 12.27).
 * Enforces per entry: known Activity, valid date, value in range, 1-3 valid
 * tags unique by `tagKey`, at most one entry per (activityId, date, comboKey);
 * per ratio: valid tag, ratio in range, one per tag; and one spelling per
 * `tagKey` across entries and ratios.
 */
function validateTagged(
  rawTagged: unknown[],
  rawRatios: unknown[],
  activityIds: Set<string>,
  codec: ValueCodec,
): Result<{ tagged: TaggedValue[]; ratios: TagRatio[] }, RuleViolation> {
  const tagged: TaggedValue[] = []
  const seen = new Set<string>()
  const spelling = new Map<string, string>()

  const checkSpelling = (tag: string, path: string): string | null => {
    const key = tagKey(tag)
    const existing = spelling.get(key)
    if (existing !== undefined && existing !== tag) {
      return `${path}: tag spelled differently from "${existing}"`
    }
    spelling.set(key, tag)
    return null
  }

  for (let i = 0; i < rawTagged.length; i += 1) {
    const path = `taggedValues[${i}]`
    const raw = rawTagged[i]
    if (!isRecord(raw)) return err({ problem: `${path}: not an object` })
    const fields = codec === 'milli' ? TAGGED_STORE_FIELDS : TAGGED_FILE_FIELDS
    const fieldProblem = checkExactFields(raw, fields, path)
    if (fieldProblem !== null) return err({ problem: fieldProblem })

    const { activityId, date, tags, value } = raw
    if (typeof activityId !== 'string' || !activityIds.has(activityId)) {
      return err({ problem: `${path}.activityId: references an unknown activity` })
    }
    if (typeof date !== 'string' || !isValidLocalDate(date)) {
      return err({ problem: `${path}.date: must be a valid YYYY-MM-DD date` })
    }
    if (!Array.isArray(tags) || tags.length < 1 || tags.length > TAGS_PER_ENTRY_MAX) {
      return err({ problem: `${path}.tags: must be 1 to ${TAGS_PER_ENTRY_MAX} tags` })
    }
    const keys = new Set<string>()
    for (let t = 0; t < tags.length; t += 1) {
      const tag: unknown = tags[t]
      const valid = typeof tag === 'string' ? validateTag(tag) : null
      if (valid === null || !valid.ok || valid.value !== tag) {
        return err({ problem: `${path}.tags[${t}]: not a valid tag` })
      }
      const key = tagKey(valid.value)
      if (keys.has(key)) return err({ problem: `${path}.tags[${t}]: duplicate tag` })
      keys.add(key)
      const clash = checkSpelling(valid.value, `${path}.tags[${t}]`)
      if (clash !== null) return err({ problem: clash })
    }
    const tagList = tags as string[]
    const combo = comboKey(tagList)
    if (codec === 'milli' && raw.comboKey !== combo) {
      return err({ problem: `${path}.comboKey: does not match tags` })
    }
    const decoded = decodeValue(value, codec, DAILY_MIN, DAILY_MAX, true)
    if (!decoded.ok) return err({ problem: `${path}.value: ${decoded.error}` })
    const entryKey = `${activityId}\u0000${date}\u0000${combo}`
    if (seen.has(entryKey)) {
      return err({ problem: `${path}: duplicate entry for (activityId, date, tags)` })
    }
    seen.add(entryKey)
    tagged.push({ activityId, date, tags: [...tagList], value: decoded.value })
  }

  const ratios: TagRatio[] = []
  const ratioKeys = new Set<string>()
  for (let i = 0; i < rawRatios.length; i += 1) {
    const path = `tagRatios[${i}]`
    const raw = rawRatios[i]
    if (!isRecord(raw)) return err({ problem: `${path}: not an object` })
    const fields = codec === 'milli' ? RATIO_STORE_FIELDS : RATIO_FILE_FIELDS
    const fieldProblem = checkExactFields(raw, fields, path)
    if (fieldProblem !== null) return err({ problem: fieldProblem })

    const label: unknown = codec === 'milli' ? raw.label : raw.tag
    const valid = typeof label === 'string' ? validateTag(label) : null
    if (valid === null || !valid.ok || valid.value !== label) {
      return err({ problem: `${path}.${codec === 'milli' ? 'label' : 'tag'}: not a valid tag` })
    }
    const key = tagKey(valid.value)
    if (codec === 'milli' && raw.key !== key) {
      return err({ problem: `${path}.key: does not match the tag` })
    }
    if (ratioKeys.has(key)) return err({ problem: `${path}: duplicate ratio for tag` })
    ratioKeys.add(key)
    const clash = checkSpelling(valid.value, path)
    if (clash !== null) return err({ problem: clash })
    const decoded = decodeValue(raw.ratio, codec, RATIO_MIN, RATIO_MAX)
    if (!decoded.ok) return err({ problem: `${path}.ratio: ${decoded.error.replace('value', 'ratio')}` })
    // A stored 1.000 is accepted on import and normalised away (it equals "no ratio").
    if (decoded.value !== 1000) ratios.push({ key, label: valid.value, ratio: decoded.value })
  }
  return ok({ tagged, ratios })
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
  options: RuleOptions,
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

  if (options.tagged === 'forbidden') {
    if (raw.taggedValues !== undefined) return err({ problem: 'taggedValues: not allowed in this format' })
    if (raw.tagRatios !== undefined) return err({ problem: 'tagRatios: not allowed in this format' })
  } else if (options.tagged === 'required') {
    if (!Array.isArray(raw.taggedValues)) return err({ problem: 'taggedValues: must be an array' })
    if (!Array.isArray(raw.tagRatios)) return err({ problem: 'tagRatios: must be an array' })
  }
  const rawTagged = raw.taggedValues ?? []
  const rawRatios = raw.tagRatios ?? []

  const activitiesResult = validateActivities(raw.activities)
  if (!activitiesResult.ok) return err(activitiesResult.error)
  const { activities, ids } = activitiesResult.value

  const dailyValuesResult = validateDailyValues(raw.dailyValues, ids, valueCodec, options.allowNegative)
  if (!dailyValuesResult.ok) return err(dailyValuesResult.error)

  const goalVersionsResult = validateGoalVersions(raw.goalVersions, ids, valueCodec)
  if (!goalVersionsResult.ok) return err(goalVersionsResult.error)

  const taggedResult = validateTagged(rawTagged, rawRatios, ids, valueCodec)
  if (!taggedResult.ok) return err(taggedResult.error)

  // Build the immutable Daily_Value index with structural-sharing helpers.
  let values = new Map() as Dataset['values']
  for (const dv of dailyValuesResult.value) {
    values = setDailyValue(values, dv.activityId, dv.date, dv.value)
  }

  let taggedValues = new Map() as Dataset['taggedValues']
  for (const entry of taggedResult.value.tagged) {
    taggedValues = setTaggedValue(taggedValues, entry, comboKey(entry.tags))
  }
  const tagRatios = new Map(taggedResult.value.ratios.map((r) => [r.key, r]))

  return ok({
    activities,
    values,
    taggedValues,
    tagRatios,
    goalVersions: goalVersionsResult.value,
  })
}
