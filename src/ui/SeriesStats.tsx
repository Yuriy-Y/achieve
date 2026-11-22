/**
 * Statistics table of the Analyser (Req 16.13, 16.14): total, average per
 * position, highest and lowest position for every series, shown with the
 * Device_Locale number format. Rows are pre-formatted strings so no `bigint`
 * reaches React props.
 */
import type { ReactElement } from 'react'
import type { StatsRow } from './seriesStatsRows'

export function SeriesStats({ rows }: { rows: readonly StatsRow[] }): ReactElement {
  return (
    <table className="series-stats">
      <caption className="series-stats-caption">Statistics for the shown positions</caption>
      <thead>
        <tr>
          <th scope="col">Series</th>
          <th scope="col">Total</th>
          <th scope="col">Average</th>
          <th scope="col">Highest</th>
          <th scope="col">Lowest</th>
          {rows.some((r) => r.trend !== undefined) ? <th scope="col">Trend</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row">{r.label}</th>
            <td>{r.total}</td>
            <td>{r.average}</td>
            <td>{r.highest}</td>
            <td>{r.lowest}</td>
            {r.trend === undefined ? null : <td>{r.trend}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
