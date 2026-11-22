/**
 * Backup_File export and import for the Achievement Tracker.
 *
 * This module is the Backup_Manager's pure domain core (design: "Domain:
 * backup.ts", "Browser integration: export/import"). It has no React, browser
 * or storage dependencies: it turns an in-memory `Dataset` into Backup_File
 * JSON text and back, and computes the Backup_File name.
 *
 * Design decisions honoured here:
 *   - Format marker `achievement-tracker-backup` and current format version 2
 *     (Req 12.1, 12.24); version 1 stays readable (Req 12.25). Only versions in `SUPPORTED_BACKUP_FORMAT_VERSIONS` are read
 *     (Req 12.10).
 *   - Values are serialised as strict three-decimal strings with
 *     `formatMilliFixed3` (Req 12.1): strings, not JSON numbers, keep the file
 *     exact regardless of the reader's number handling.
 *   - Deterministic, stable ordering so export is idempotent (Req 12.18):
 *     Activities by `(createdAt, createdSeq)`; Daily_Values by Activity order
 *     then date; Goal_Versions by Activity order, goal type, then start Period.
 *   - `serialiseBackup` is synchronous and works from the in-memory `Dataset`,
 *     so the export button can call `navigator.share` in the same user gesture.
 *   - `parseBackup` validates the whole file before anything changes (Req
 *     12.7) and stops at the first problem (Req 12.9), checking: valid JSON,
 *     then the format marker and a positive integer version, then a supported
 *     version, then structure and the shared business rules via
 *     `validateDatasetRules(raw, 'fixed3', options)` (Req 12.8). Unknown extra fields
 *     are rejected (so a file from a newer format is never half-imported).
 *   - Future-dated Daily_Values and Goal_Versions are accepted; only the value
 *     and key rules apply (Req 12.21), which `datasetRules` already enforces.
 *
 * The export/import round trip yields an equivalent `Dataset` under
 * `datasetEquals` (Req 12.17), which the round-trip property test relies on.
 */

import { compareDates, type GoalType, type PeriodKey } from './calendar'
import { allTaggedValues, type Activity, type DailyValue, type Dataset, type GoalVersion, type TaggedValue } from './dataset'
import { formatMilliFixed3 } from './decimal'
import { validateDatasetRules, type RawDataset } from './datasetRules'
import { err, ok, type Result } from './result'

/** Backup_File format marker; identifies a file as a Tracker backup (Req 12.1). */
export const BACKUP_FORMAT = 'achievement-tracker-backup'

/** The Backup_Format_Version written by this App_Version (Req 12.1). */
export const CURRENT_BACKUP_FORMAT_VERSION = 2

/** Backup_Format_Versions this App_Version can read (Req 12.10). */
export const SUPPORTED_BACKUP_FORMAT_VERSIONS: readonly number[] = [1, 2]

/** Summary of a parsed Backup_File shown in the import confirmation (Req 12.11). */
export interface BackupMeta {
  formatVersion: number
  exportedAt: string
  activityCount: number
}

/**
 * Why a Backup_File could not be imported (design "Domain: backup.ts"). The
 * first problem found is reported (Req 12.9).
 */
export type BackupError =
  | { code: 'notJson' }
  | { code: 'notBackup'; problem: string }
  | { code: 'unsupportedVersion'; version: number }
  | { code: 'invalid'; problem: string }

/** Serialised shape of one Activity in the Backup_File. */
interface ActivityJson {
  id: string
  name: string
  createdAt: string
  createdSeq: number
}

/** Serialised shape of one Daily_Value: value as a fixed 3-decimal string. */
interface DailyValueJson {
  activityId: string
  date: string
  value: string
}

/** Serialised shape of one Goal_Version: `value` present only for `set`. */
interface GoalVersionJson {
  activityId: string
  goalType: GoalType
  startPeriod: PeriodKey
  kind: 'set' | 'removal'
  value?: string
}

/** Serialised tagged Daily_Entry (format version 2). */
interface TaggedValueJson {
  activityId: string
  date: string
  tags: string[]
  value: string
}
/** Serialised Tag_Ratio (format version 2). */
interface TagRatioJson {
  tag: string
  ratio: string
}
/** Full Backup_File shape (format version 2; version 1 has no tagged lists). */
interface BackupJson {
  format: string
  formatVersion: number
  exportedAt: string
  activities: ActivityJson[]
  dailyValues: DailyValueJson[]
  goalVersions: GoalVersionJson[]
  taggedValues: TaggedValueJson[]
  tagRatios: TagRatioJson[]
}

/** Activities in stable creation order: `(createdAt, createdSeq)` ascending. */
function sortedActivities(ds: Dataset): Activity[] {
  return [...ds.activities].sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1
    if (a.createdAt > b.createdAt) return 1
    return a.createdSeq - b.createdSeq
  })
}

/**
 * Daily_Values ordered by Activity creation order, then by date ascending.
 * Only stored entries are exported (including explicit zeros); missing Days
 * stay missing and still read as 0.
 */
function orderedDailyValues(ds: Dataset, activities: readonly Activity[]): DailyValue[] {
  const result: DailyValue[] = []
  for (const activity of activities) {
    const inner = ds.values.get(activity.id)
    if (inner === undefined) continue
    const dates = [...inner.keys()].sort(compareDates)
    for (const date of dates) {
      result.push({ activityId: activity.id, date, value: inner.get(date) as number })
    }
  }
  return result
}

/** Tagged entries by Activity creation order, then date, then comboKey. */
function orderedTaggedValues(ds: Dataset, activities: readonly Activity[]): TaggedValue[] {
  const rank = new Map<string, number>()
  activities.forEach((a, i) => rank.set(a.id, i))
  return allTaggedValues(ds.taggedValues)
    .sort((a, b) => {
      const r = (rank.get(a.entry.activityId) ?? 0) - (rank.get(b.entry.activityId) ?? 0)
      if (r !== 0) return r
      if (a.entry.date !== b.entry.date) return a.entry.date < b.entry.date ? -1 : 1
      return a.comboKey < b.comboKey ? -1 : a.comboKey > b.comboKey ? 1 : 0
    })
    .map((x) => x.entry)
}

/** Weekly before monthly on ties, matching the design's stable order. */
function goalTypeRank(goalType: GoalType): number {
  return goalType === 'weekly' ? 0 : 1
}

/**
 * Goal_Versions ordered by Activity creation order, then goal type (weekly
 * before monthly), then start Period ascending. Keys are zero-padded, so
 * lexicographic order of `startPeriod` is chronological within a type.
 */
function orderedGoalVersions(ds: Dataset, activities: readonly Activity[]): GoalVersion[] {
  const activityRank = new Map<string, number>()
  activities.forEach((activity, index) => activityRank.set(activity.id, index))

  return [...ds.goalVersions].sort((a, b) => {
    const rankA = activityRank.get(a.activityId) ?? Number.MAX_SAFE_INTEGER
    const rankB = activityRank.get(b.activityId) ?? Number.MAX_SAFE_INTEGER
    if (rankA !== rankB) return rankA - rankB
    const typeDiff = goalTypeRank(a.goalType) - goalTypeRank(b.goalType)
    if (typeDiff !== 0) return typeDiff
    if (a.startPeriod < b.startPeriod) return -1
    if (a.startPeriod > b.startPeriod) return 1
    return 0
  })
}

/**
 * Serialise a Dataset to Backup_File JSON text (Req 12.1). Synchronous and
 * deterministic: identical Datasets produce byte-identical text apart from
 * `exportedAt`, so export is idempotent (Req 12.18). An empty Dataset produces
 * a valid Backup_File with empty arrays (Req 12.6).
 *
 * @param ds         The Dataset to export.
 * @param exportedAt The export time; written as an ISO 8601 UTC timestamp.
 */
export function serialiseBackup(ds: Dataset, exportedAt: Date): string {
  const activities = sortedActivities(ds)

  const backup: BackupJson = {
    format: BACKUP_FORMAT,
    formatVersion: CURRENT_BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    activities: activities.map((activity) => ({
      id: activity.id,
      name: activity.name,
      createdAt: activity.createdAt,
      createdSeq: activity.createdSeq,
    })),
    dailyValues: orderedDailyValues(ds, activities).map((dv) => ({
      activityId: dv.activityId,
      date: dv.date,
      value: formatMilliFixed3(dv.value),
    })),
    taggedValues: orderedTaggedValues(ds, activities).map((e) => ({
      activityId: e.activityId,
      date: e.date,
      tags: [...e.tags],
      value: formatMilliFixed3(e.value),
    })),
    tagRatios: [...ds.tagRatios.values()]
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map((r) => ({ tag: r.label, ratio: formatMilliFixed3(r.ratio) })),
    goalVersions: orderedGoalVersions(ds, activities).map((version) =>
      version.kind === 'set'
        ? {
            activityId: version.activityId,
            goalType: version.goalType,
            startPeriod: version.startPeriod,
            kind: 'set',
            value: formatMilliFixed3(version.value),
          }
        : {
            activityId: version.activityId,
            goalType: version.goalType,
            startPeriod: version.startPeriod,
            kind: 'removal',
          },
    ),
  }

  return JSON.stringify(backup, null, 2)
}

/**
 * Backup_File name: the prefix, the export LocalDate in `YYYY-MM-DD`, and the
 * `.json` extension (Req 12.3). The caller passes the export date already in
 * the Device_Locale (`todayLocal`).
 */
export function backupFileName(exportLocalDate: string): string {
  return `achievement-tracker-backup-${exportLocalDate}.json`
}

/** True for an integer >= 1 (a positive-integer Backup_Format_Version). */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

/** A plain (non-null, non-array) object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ISO 8601 UTC timestamp as produced by `Date.prototype.toISOString`. */
const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/** True when `value` is a syntactically valid ISO 8601 UTC timestamp string. */
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_TIMESTAMP_RE.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

/** Top-level fields of a format version 1 Backup_File; no extra fields allowed. */
const BACKUP_FIELDS_V1: readonly string[] = [
  'format',
  'formatVersion',
  'exportedAt',
  'activities',
  'dailyValues',
  'goalVersions',
]
/** Format version 2 adds the tagged entries and the Tag_Ratios (Req 12.24). */
const BACKUP_FIELDS_V2: readonly string[] = [...BACKUP_FIELDS_V1, 'taggedValues', 'tagRatios']

/**
 * Parse and validate a Backup_File string (Req 12.7-12.10). Checks run in a
 * fixed order and stop at the first problem:
 *   1. `JSON.parse` succeeds, else `notJson`.
 *   2. Root is an object with `format === BACKUP_FORMAT` and a positive-integer
 *      `formatVersion`, else `notBackup`.
 *   3. `formatVersion` is supported, else `unsupportedVersion`.
 *   4. Top-level structure: exactly the expected fields, an ISO `exportedAt`,
 *      and `activities` / `dailyValues` / `goalVersions` arrays.
 *   5. Business rules via `validateDatasetRules(raw, 'fixed3', options)` (Req 12.8).
 *
 * On success returns the import summary (`BackupMeta`) and the validated,
 * immutable `Dataset`. Nothing is mutated here; the caller decides whether to
 * import after showing the confirmation (Req 12.11, 12.12).
 */
export function parseBackup(
  text: string,
): Result<{ meta: BackupMeta; dataset: Dataset }, BackupError> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return err({ code: 'notJson' })
  }

  if (!isRecord(parsed)) {
    return err({ code: 'notBackup', problem: 'the file is not a JSON object' })
  }

  if (parsed.format !== BACKUP_FORMAT) {
    return err({ code: 'notBackup', problem: 'missing or unexpected format marker' })
  }

  if (!isPositiveInteger(parsed.formatVersion)) {
    return err({ code: 'notBackup', problem: 'formatVersion must be a positive integer' })
  }

  const version = parsed.formatVersion
  if (!SUPPORTED_BACKUP_FORMAT_VERSIONS.includes(version)) {
    return err({ code: 'unsupportedVersion', version })
  }

  const fields = version === 1 ? BACKUP_FIELDS_V1 : BACKUP_FIELDS_V2
  for (const key of fields) {
    if (!Object.prototype.hasOwnProperty.call(parsed, key)) {
      return err({ code: 'invalid', problem: `missing field ${key}` })
    }
  }
  for (const key of Object.keys(parsed)) {
    if (!fields.includes(key)) {
      return err({ code: 'invalid', problem: `unexpected field ${key}` })
    }
  }

  if (!isIsoTimestamp(parsed.exportedAt)) {
    return err({ code: 'invalid', problem: 'exportedAt: must be an ISO 8601 UTC timestamp' })
  }

  if (!Array.isArray(parsed.activities)) {
    return err({ code: 'invalid', problem: 'activities: must be an array' })
  }
  if (!Array.isArray(parsed.dailyValues)) {
    return err({ code: 'invalid', problem: 'dailyValues: must be an array' })
  }
  if (!Array.isArray(parsed.goalVersions)) {
    return err({ code: 'invalid', problem: 'goalVersions: must be an array' })
  }

  const raw: RawDataset = {
    activities: parsed.activities,
    dailyValues: parsed.dailyValues,
    goalVersions: parsed.goalVersions,
  }
  if (version >= 2) {
    if (!Array.isArray(parsed.taggedValues)) {
      return err({ code: 'invalid', problem: 'taggedValues: must be an array' })
    }
    if (!Array.isArray(parsed.tagRatios)) {
      return err({ code: 'invalid', problem: 'tagRatios: must be an array' })
    }
    raw.taggedValues = parsed.taggedValues
    raw.tagRatios = parsed.tagRatios
  }

  // Version 1: non-negative values, no tagged lists. Version 2: signed, lists required.
  const validated = validateDatasetRules(
    raw,
    'fixed3',
    version === 1
      ? { allowNegative: false, tagged: 'forbidden' }
      : { allowNegative: true, tagged: 'required' },
  )
  if (!validated.ok) {
    return err({ code: 'invalid', problem: validated.error.problem })
  }

  const meta: BackupMeta = {
    formatVersion: version,
    exportedAt: parsed.exportedAt,
    activityCount: validated.value.activities.length,
  }

  return ok({ meta, dataset: validated.value })
}
