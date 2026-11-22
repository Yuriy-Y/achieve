import type { AnalyserModel, Trend } from '../domain/analyser'
import type { NumberDisplay } from '../domain/numberFormat'
import type { ChartModelV2 } from '../domain/viewModels'

export interface StatsRow {
  id: string
  label: string
  total: string
  average: string
  highest: string
  lowest: string
  /** Present only while the trend is shown (Req 16.23). */
  trend?: string
}

/** Format the statistics of every series for display. */
/** "\u25b2 +1.2 per day", "\u25bc -0.4 per week" or "\u25ac flat"; a dash when there is too little data. */
function trendText(trend: Trend | null | undefined, unit: string, fmt: NumberDisplay): string {
  if (trend === undefined) return ''
  if (trend === null) return '\u2013'
  if (trend.direction === 'flat') return '\u25ac flat'
  const amount = fmt.valueBig(BigInt(Math.round(trend.slope)))
  const signed = trend.slope > 0 ? `+${amount}` : amount
  return `${trend.direction === 'up' ? '\u25b2' : '\u25bc'} ${signed} per ${unit}`
}

export function statsRows(
  model: AnalyserModel,
  chart: ChartModelV2,
  fmt: NumberDisplay,
  trends?: readonly (Trend | null)[],
  unit = 'position',
): StatsRow[] {
  const at = (extreme: { value: bigint; index: number } | null): string =>
    extreme === null ? '\u2013' : `${fmt.valueBig(extreme.value)} (${chart.positions[extreme.index]?.label ?? ''})`
  return model.series.map((r, i) => ({
    id: r.spec.id,
    label: r.spec.label,
    total: fmt.valueBig(r.stats.total),
    average: r.stats.average === null ? '\u2013' : fmt.valueBig(r.stats.average),
    highest: at(r.stats.highest),
    lowest: at(r.stats.lowest),
    trend: trends === undefined ? undefined : trendText(trends[i] ?? null, unit, fmt),
  }))
}

