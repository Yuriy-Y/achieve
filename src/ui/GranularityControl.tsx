/**
 * `GranularityControl` — Day / Week / Month selector (Req 15.1) plus, for Day
 * granularity, the Span control Week / Month (Req 15.2). Shared by the Chart_View
 * and the Analyser. Each option is a 44 px toggle button in a labelled group.
 */
import type { ReactElement } from 'react'
import type { Granularity, Span } from '../domain/granularity'

export interface GranularityControlProps {
  granularity: Granularity
  span: Span
  onGranularity: (granularity: Granularity) => void
  onSpan: (span: Span) => void
}

const GRANULARITIES: readonly { value: Granularity; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]
const SPANS: readonly { value: Span; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
]

export function GranularityControl({
  granularity,
  span,
  onGranularity,
  onSpan,
}: GranularityControlProps): ReactElement {
  return (
    <div className="granularity-control">
      <div className="chart-view-type-toggle" role="group" aria-label="Granularity">
        {GRANULARITIES.map((option) => (
          <button
            key={option.value}
            type="button"
            className="chart-view-type-button"
            aria-pressed={granularity === option.value}
            onClick={() => onGranularity(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {granularity === 'day' ? (
        <div className="chart-view-type-toggle" role="group" aria-label="Span">
          {SPANS.map((option) => (
            <button
              key={option.value}
              type="button"
              className="chart-view-type-button"
              aria-pressed={span === option.value}
              onClick={() => onSpan(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
