/**
 * Legend of the Analyser chart: every series by name with a pattern swatch, so
 * series are identified without relying on colour (Req 16.12).
 */
import { useId } from 'react'
import type { ReactElement } from 'react'
import type { ChartSeries } from '../domain/viewModels'

export function SeriesLegend({ series }: { series: readonly ChartSeries[] }): ReactElement {
  const prefix = useId()
  return (
    <ul className="series-legend" aria-label="Legend">
      {series.map((s, i) => {
        const patternId = `${prefix}-${s.id.replace(/[^a-z0-9]/gi, '_')}`
        const colour = `bar-chart-series-${i % 6}`
        return (
          <li key={s.id} className="series-legend-item">
            <svg className="series-legend-swatch" width={28} height={16} viewBox="0 0 28 16" aria-hidden="true">
              <defs>
                <pattern id={patternId} patternUnits="userSpaceOnUse" width={8} height={8}>
                  <rect className={colour} width={8} height={8} />
                  {s.marker === 'diagonal' ? <path className="bar-chart-mark" d="M0 8 L8 0" /> : null}
                  {s.marker === 'dots' ? <circle className="bar-chart-mark-fill" cx={4} cy={4} r={1.6} /> : null}
                  {s.marker === 'cross' ? <path className="bar-chart-mark" d="M0 0 L8 8 M8 0 L0 8" /> : null}
                  {s.marker === 'dashed' ? <path className="bar-chart-mark" d="M0 4 L4 4" /> : null}
                  {s.marker === 'wave' ? <path className="bar-chart-mark" d="M0 5 Q2 1 4 5 T8 5" /> : null}
                </pattern>
              </defs>
              <rect
                className={s.marker === 'solid' ? colour : undefined}
                width={28}
                height={16}
                fill={s.marker === 'solid' ? undefined : `url(#${patternId})`}
              />
            </svg>
            <span className="series-legend-label">{s.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
