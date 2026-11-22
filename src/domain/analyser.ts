/**
 * The Analyser (Requirement 16): aggregates Daily_Entries over chosen
 * Activities and Tags per chart position. Pure and read-only.
 *
 * Series: with neither a Tag nor "Not tagged" chosen there is one "All"
 * series; otherwise one series per chosen Tag (entries whose Tag_Combination
 * contains the Tag) and, when chosen, a "Not tagged" series (entries with the
 * empty combination). With `applyRatios` every entry counts as its
 * Weighted_Value; untagged entries always have weight 1. Sums are `bigint`
 * because weighted values can exceed the safe integer range.
 */
import { compareDates, type LocalDate } from './calendar'
import { dayEntries, type Activity, type Dataset } from './dataset'
import { chartWindow, type Bucket, type WindowSpec } from './granularity'
import { tagKey, tagLibrary, weightedValue } from './tags'

export const ANALYSER_SERIES_MAX = 6

export interface AnalyserChoice {
  /** Empty means all Activities (Req 16.4). */
  activityIds: readonly string[]
  /** Chosen Tags by `tagKey`, in chosen order. */
  tagKeys: readonly string[]
  /** The "Not tagged" series (Req 16.6). */
  includeUntagged: boolean
  /** "Apply tag ratios" (Req 16.7); off by default. */
  applyRatios: boolean
}

export const defaultChoice: AnalyserChoice = {
  activityIds: [],
  tagKeys: [],
  includeUntagged: false,
  applyRatios: false,
}

export interface SeriesSpec {
  id: string
  label: string
  kind: 'all' | 'tag' | 'untagged'
  tagKey: string | null
}

export interface SeriesStats {
  total: bigint
  /** Over buckets that start on or before today; half away from zero; null if none. */
  average: bigint | null
  highest: { value: bigint; index: number } | null
  lowest: { value: bigint; index: number } | null
}

export interface AnalyserSeriesResult {
  spec: SeriesSpec
  values: bigint[]
  stats: SeriesStats
  note: 'noEntriesWithTag' | 'noUntaggedEntries' | null
}

export interface AnalyserModel {
  buckets: Bucket[]
  series: AnalyserSeriesResult[]
  usedActivities: Activity[]
  ratiosApplied: boolean
}

/** Series of a choice (Req 16.5, 16.6): chosen tags in order, then "Not tagged". */
export function analyserSeries(ds: Dataset, choice: AnalyserChoice): SeriesSpec[] {
  const keys = [...new Set(choice.tagKeys)]
  if (keys.length === 0 && !choice.includeUntagged) {
    return [{ id: 'all', label: 'All', kind: 'all', tagKey: null }]
  }
  const labels = new Map(tagLibrary(ds).map((t) => [t.key, t.label]))
  const specs: SeriesSpec[] = keys.map((key) => ({
    id: `tag:${key}`,
    label: labels.get(key) ?? ds.tagRatios.get(key)?.label ?? key,
    kind: 'tag' as const,
    tagKey: key,
  }))
  if (choice.includeUntagged) {
    specs.push({ id: 'untagged', label: 'Not tagged', kind: 'untagged', tagKey: null })
  }
  return specs
}

function roundedDivide(sum: bigint, count: bigint): bigint {
  const negative = sum < 0n
  const magnitude = negative ? -sum : sum
  const q = (2n * magnitude + count) / (2n * count)
  return negative ? -q : q
}

/** Statistics of one series (Req 16.13). */
export function seriesStats(values: readonly bigint[], buckets: readonly Bucket[], today: LocalDate): SeriesStats {
  let total = 0n
  for (const v of values) total += v
  let started = 0n
  let sum = 0n
  let highest: SeriesStats['highest'] = null
  let lowest: SeriesStats['lowest'] = null
  values.forEach((value, index) => {
    if (compareDates(buckets[index].start, today) > 0) return
    started += 1n
    sum += value
    if (highest === null || value > highest.value) highest = { value, index }
    if (lowest === null || value < lowest.value) lowest = { value, index }
  })
  return { total, average: started === 0n ? null : roundedDivide(sum, started), highest, lowest }
}

/** Which tags and whether untagged entries exist for the used Activities (any date). */
function presence(ds: Dataset, used: readonly Activity[]): { tags: Set<string>; untagged: boolean } {
  const tags = new Set<string>()
  let untagged = false
  for (const activity of used) {
    if ((ds.values.get(activity.id)?.size ?? 0) > 0) untagged = true
    for (const byCombo of ds.taggedValues.get(activity.id)?.values() ?? []) {
      for (const entry of byCombo.values()) for (const t of entry.tags) tags.add(tagKey(t))
    }
  }
  return { tags, untagged }
}

/** Straight-line trend of one series over the started positions (Req 16.23). */
export interface Trend {
  /** Change per position, in milli (display only; floating point is fine here). */
  slope: number
  /** Fitted value at position 0 and at `lastIndex`, in milli. */
  startValue: number
  endValue: number
  /** Index of the last started position the line runs to. */
  lastIndex: number
  direction: 'up' | 'down' | 'flat'
}

/**
 * Least-squares line through the positions that start on or before today.
 * Needs at least 2 such positions; otherwise `null`. A change below half a
 * milli per position counts as flat.
 */
export function seriesTrend(
  values: readonly bigint[],
  buckets: readonly Bucket[],
  today: LocalDate,
): Trend | null {
  const ys: number[] = []
  for (let i = 0; i < values.length; i += 1) {
    if (compareDates(buckets[i].start, today) > 0) break
    ys.push(Number(values[i]))
  }
  const n = ys.length
  if (n < 2) return null
  const meanX = (n - 1) / 2
  const meanY = ys.reduce((a, b) => a + b, 0) / n
  let num = 0
  let den = 0
  ys.forEach((y, x) => {
    num += (x - meanX) * (y - meanY)
    den += (x - meanX) ** 2
  })
  const slope = num / den
  const intercept = meanY - slope * meanX
  return {
    slope,
    startValue: intercept,
    endValue: intercept + slope * (n - 1),
    lastIndex: n - 1,
    direction: Math.abs(slope) < 0.5 ? 'flat' : slope > 0 ? 'up' : 'down',
  }
}

export function analyserModel(
  ds: Dataset,
  choice: AnalyserChoice,
  window: WindowSpec,
  today: LocalDate,
): AnalyserModel {
  const ids = new Set(choice.activityIds)
  const used = ids.size === 0 ? [...ds.activities] : ds.activities.filter((a) => ids.has(a.id))
  const buckets = chartWindow(window, today)
  const specs = analyserSeries(ds, choice)
  const sums = specs.map(() => buckets.map(() => 0n))

  buckets.forEach((bucket, b) => {
    for (const activity of used) {
      for (const day of bucket.days) {
        for (const entry of dayEntries(ds, activity.id, day)) {
          const keys = new Set(entry.tags.map(tagKey))
          const amount = choice.applyRatios ? weightedValue(entry, ds.tagRatios) : BigInt(entry.value)
          specs.forEach((spec, s) => {
            const qualifies =
              spec.kind === 'all' ||
              (spec.kind === 'untagged' && entry.tags.length === 0) ||
              (spec.kind === 'tag' && spec.tagKey !== null && keys.has(spec.tagKey))
            if (!qualifies) return
            sums[s][b] += amount
          })
        }
      }
    }
  })

  // The note concerns all entries of the used Activities, not just the shown window (Req 16.15).
  const present = presence(ds, used)
  const series = specs.map((spec, s): AnalyserSeriesResult => {
    let note: AnalyserSeriesResult['note'] = null
    if (spec.kind === 'tag' ? !present.tags.has(spec.tagKey ?? '') : spec.kind === 'untagged' && !present.untagged) {
      note = spec.kind === 'tag' ? 'noEntriesWithTag' : 'noUntaggedEntries'
    }
    return { spec, values: sums[s], stats: seriesStats(sums[s], buckets, today), note }
  })
  return { buckets, series, usedActivities: used, ratiosApplied: choice.applyRatios }
}
