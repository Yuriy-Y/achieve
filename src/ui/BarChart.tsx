/**
 * `BarChart` — the accessible SVG bar chart used by the Chart_View and the
 * Analyser (design: UI components — `BarChart` / `useChartLayout`, and
 * "Chart rendering: signed, multi-series, goals").
 *
 * Why SVG and not a canvas chart: Requirement 5.9 needs every position to be
 * keyboard-focusable with its own accessible label, and Req 11.2 needs each
 * position to be a 44x44 CSS-pixel Touch_Target. Each position is a focusable
 * `<g role="img">` carrying the model's `ariaLabel`.
 *
 * Signed values (Req 13.5): bars grow from a common zero baseline, upwards or
 * rightwards for positive values and the other way for negative values, with
 * one scale for both directions (`chartScale`).
 *
 * Several series (Analyser, Req 16.12): the bars of one position are drawn side
 * by side. Series are told apart by an SVG pattern marker plus the legend, not
 * by colour alone. A position stays at least 44 px across (`max(44, 14 x
 * series)`), matching `chartOrientation`.
 *
 * Bar geometry uses SVG attributes only (x, y, width, height), never the `style`
 * attribute, so the CSP `style-src 'self'` is respected. Colours and hatching
 * come from CSS classes.
 *
 * Orientation (Req 5.12-5.15): rows draw the first position at the top, columns
 * draw it on the left. Keyboard: one position is in the tab order (roving
 * tabindex); arrows, Home and End move focus.
 */
import { useEffect, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import type { ChartModelV2, ChartPositionV2, ChartSeries } from '../domain/viewModels'
import { SERIES_BAR_PX, TOUCH_MIN_PX, chartScale } from '../domain/viewModels'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useChartLayout } from './useChartLayout'

/** Props for {@link BarChart}. */
/** A straight line over the chart for one series (Analyser trend, Req 16.23). */
export interface TrendLine {
  fromIndex: number
  fromValue: number
  toIndex: number
  toValue: number
}

export interface BarChartProps {
  model: ChartModelV2
  /** One optional trend line per series. */
  trends?: readonly (TrendLine | null)[]
}

/** A "nice" tick step (1, 2 or 5 times a power of ten) for about `target` ticks. */
function niceStep(range: number, target: number): number {
  if (range <= 0) return 1
  const raw = range / target
  const pow = 10 ** Math.floor(Math.log10(raw))
  const f = raw / pow
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
}

/** Y axis ticks in milli units for a scale, always including the zero baseline. */
function axisTicks(scale: { zeroPx: number; pxPerUnit: number }): number[] {
  if (scale.pxPerUnit <= 0) return [0]
  const max = (AXIS_PX - scale.zeroPx) / scale.pxPerUnit
  const min = -scale.zeroPx / scale.pxPerUnit
  const step = Math.max(1, niceStep(max - min, 4))
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) ticks.push(Math.round(t))
  return ticks
}

/**
 * Time always runs left to right (horizontal time series), on phones too. When
 * the positions do not fit the width, the chart scrolls horizontally inside its
 * own box (the page itself never scrolls sideways, Req 11.1); every position
 * keeps its 44 px touch width (Req 11.2). The vertical-rows layout stays in the
 * code behind this switch.
 */
const HORIZONTAL_TIME_AXIS = true

/** Length of the value axis (bar growth direction) in CSS pixels. */
const AXIS_PX = 240
/** Space reserved at the start of the value axis for the position label (rows). */
const LABEL_PX = 56
/** Maximum bar thickness inside a position, in CSS pixels. */
const BAR_THICKNESS_PX = 28

export function BarChart({ model, trends = [] }: BarChartProps): ReactElement {
  const fmt = useNumberDisplay()
  const { positions, series } = model
  const seriesCount = Math.max(1, series.length)
  const { containerRef, orientation: measured } = useChartLayout(positions.length, seriesCount)
  const orientation = HORIZONTAL_TIME_AXIS ? 'columns' : measured
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [focusIndex, setFocusIndex] = useState(0)
  const groupsRef = useRef<Array<SVGGElement | null>>([])
  const titleId = useId()
  const idPrefix = useId()

  // Move focus to a position, keeping the roving tabindex in step.
  const focusAt = (index: number, count: number): void => {
    if (count === 0) return
    const clamped = index < 0 ? 0 : index >= count ? count - 1 : index
    setFocusIndex(clamped)
    groupsRef.current[clamped]?.focus()
  }

  // Arrow keys move between positions; Home/End jump to the first/last.
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>): void => {
    const count = positions.length
    if (count === 0) return
    let next: number
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = focusIndex + 1
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        next = focusIndex - 1
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      default:
        return
    }
    event.preventDefault()
    focusAt(next, count)
  }

  const isRows = orientation === 'rows'
  const count = positions.length

  // Show the newest recorded positions: scroll so the last position that is not
  // in the future ends at the right edge (the window may extend past today).
  useEffect(() => {
    const toEnd = (): void => {
      const el = scrollRef.current
      if (el === null) return
      const slotPx = Math.max(TOUCH_MIN_PX, SERIES_BAR_PX * seriesCount)
      let last = positions.length - 1
      while (last > 0 && positions[last].isFuture) last -= 1
      el.scrollLeft = Math.max(0, (last + 1) * slotPx - el.clientWidth)
    }
    toEnd()
    window.addEventListener('resize', toEnd)
    return () => window.removeEventListener('resize', toEnd)
  }, [count, model.title, positions, seriesCount])
  const slot = Math.max(TOUCH_MIN_PX, SERIES_BAR_PX * seriesCount)
  const barThickness = Math.min(BAR_THICKNESS_PX, Math.floor((slot - 8) / seriesCount))

  const trendValues = trends.flatMap((t) => (t === null ? [] : [t.fromValue, t.toValue]))
  const allValues = [...positions.flatMap((p) => p.values), ...trendValues]
  const goals = [
    ...positions.flatMap((p) => (p.goal === null ? [] : [p.goal.value])),
    ...(model.referenceGoal === null ? [] : [model.referenceGoal]),
  ]
  const scale = chartScale(allValues, goals, AXIS_PX)
  const hasNegative = allValues.some((v) => v !== null && v < 0)
  const ticks = isRows ? [] : axisTicks(scale)
  const tickLabels = ticks.map((t) => fmt.valueBig(BigInt(t)))
  const axisWidth = Math.max(36, Math.max(0, ...tickLabels.map((l) => l.length)) * 7 + 10)

  const svgWidth = isRows ? LABEL_PX + AXIS_PX : count * slot
  const svgHeight = isRows ? count * slot : AXIS_PX + 24
  // Axis coordinate of the zero baseline along the value axis.
  const baseline = isRows ? LABEL_PX + scale.zeroPx : AXIS_PX - scale.zeroPx
  const hatchId = `${idPrefix}-hatch`
  const patternId = (marker: string): string => `${idPrefix}-m-${marker}`

  return (
    <div className="bar-chart" ref={containerRef}>
      <p className="bar-chart-title">{model.title}</p>
      <div className="bar-chart-body">
      {isRows ? null : (
        <svg
          className="bar-chart-yaxis"
          width={axisWidth}
          height={svgHeight}
          viewBox={`0 0 ${axisWidth} ${svgHeight}`}
          aria-hidden="true"
        >
          {ticks.map((t, i) => (
            <text
              key={t}
              className="bar-chart-axis-label"
              x={axisWidth - 6}
              y={baseline - t * scale.pxPerUnit + 4}
              textAnchor="end"
            >
              {tickLabels[i]}
            </text>
          ))}
        </svg>
      )}
      <div className="bar-chart-scroll" ref={scrollRef} tabIndex={-1}>
      <svg
        className={isRows ? 'bar-chart-svg bar-chart-rows' : 'bar-chart-svg bar-chart-columns'}
        role="group"
        aria-labelledby={titleId}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        width={svgWidth}
        height={svgHeight}
        onKeyDown={handleKeyDown}
      >
        <title id={titleId}>{model.title}</title>
        <defs>
          <pattern
            id={hatchId}
            className="bar-chart-hatch"
            patternUnits="userSpaceOnUse"
            width={6}
            height={6}
            patternTransform="rotate(45)"
          >
            <line x1={0} y1={0} x2={0} y2={6} className="bar-chart-hatch-line" />
          </pattern>
          {series.map((s, i) => (
            <MarkerPattern key={s.id} id={patternId(s.marker)} series={s} index={i} />
          ))}
        </defs>

        {isRows
          ? null
          : ticks.map((t) => (
              <line
                key={`g${t}`}
                className="bar-chart-grid"
                x1={0}
                x2={svgWidth}
                y1={baseline - t * scale.pxPerUnit}
                y2={baseline - t * scale.pxPerUnit}
              />
            ))}
        {/* Reference goal across the axis (Day granularity), as in the previous version. */}
        {model.referenceGoal !== null ? (
          <GoalLine
            isRows={isRows}
            at={goalAxis(isRows, scale.zeroPx, model.referenceGoal, scale.pxPerUnit)}
            from={0}
            to={isRows ? svgHeight : svgWidth}
          />
        ) : null}
        {hasNegative ? (
          <line
            className="bar-chart-baseline"
            x1={isRows ? baseline : 0}
            y1={isRows ? 0 : baseline}
            x2={isRows ? baseline : svgWidth}
            y2={isRows ? svgHeight : baseline}
          />
        ) : null}

        {trends.map((trend, i) =>
          trend === null || isRows ? null : (
            <line
              key={`t${i}`}
              className={`bar-chart-trend bar-chart-trend-${i % 6}`}
              x1={trend.fromIndex * slot + slot / 2}
              y1={baseline - trend.fromValue * scale.pxPerUnit}
              x2={trend.toIndex * slot + slot / 2}
              y2={baseline - trend.toValue * scale.pxPerUnit}
            />
          ),
        )}
        {positions.map((position, index) => (
          <PositionBar
            key={position.start}
            position={position}
            series={series}
            index={index}
            isRows={isRows}
            slot={slot}
            barThickness={barThickness}
            scale={scale}
            baseline={baseline}
            hatchRef={`url(#${hatchId})`}
            patternId={patternId}
            tabIndex={index === focusIndex ? 0 : -1}
            registerRef={(el) => {
              groupsRef.current[index] = el
            }}
            onFocus={() => setFocusIndex(index)}
          />
        ))}
      </svg>
      </div>
      </div>
    </div>
  )
}

/** Axis coordinate of a value `v` (positive direction). */
function goalAxis(isRows: boolean, zeroPx: number, value: number, pxPerUnit: number): number {
  return isRows ? LABEL_PX + zeroPx + value * pxPerUnit : AXIS_PX - zeroPx - value * pxPerUnit
}

function GoalLine(props: { isRows: boolean; at: number; from: number; to: number }): ReactElement {
  const { isRows, at, from, to } = props
  return (
    <line
      className="bar-chart-goal-line"
      x1={isRows ? at : from}
      y1={isRows ? from : at}
      x2={isRows ? at : to}
      y2={isRows ? to : at}
    />
  )
}

/** SVG pattern that marks one series without relying on colour (Req 16.12). */
function MarkerPattern({ id, series, index }: { id: string; series: ChartSeries; index: number }): ReactElement | null {
  if (series.marker === 'solid') return null
  const colour = `bar-chart-series-${index % 6}`
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={8} height={8}>
      <rect className={colour} width={8} height={8} />
      {series.marker === 'diagonal' ? <path className="bar-chart-mark" d="M0 8 L8 0" /> : null}
      {series.marker === 'dots' ? <circle className="bar-chart-mark-fill" cx={4} cy={4} r={1.6} /> : null}
      {series.marker === 'cross' ? <path className="bar-chart-mark" d="M0 0 L8 8 M8 0 L0 8" /> : null}
      {series.marker === 'dashed' ? <path className="bar-chart-mark" d="M0 4 L4 4" /> : null}
      {series.marker === 'wave' ? <path className="bar-chart-mark" d="M0 5 Q2 1 4 5 T8 5" /> : null}
    </pattern>
  )
}

interface PositionBarProps {
  position: ChartPositionV2
  series: ChartSeries[]
  index: number
  isRows: boolean
  slot: number
  barThickness: number
  scale: { zeroPx: number; pxPerUnit: number }
  baseline: number
  hatchRef: string
  patternId: (marker: string) => string
  tabIndex: number
  registerRef: (element: SVGGElement | null) => void
  onFocus: () => void
}

/**
 * One position: a focusable, labelled `<g role="img">` holding the 44px hit
 * area, one bar per series (or the hatched "future" marker), an optional goal
 * tick and the short label.
 */
function PositionBar({
  position,
  series,
  index,
  isRows,
  slot,
  barThickness,
  scale,
  baseline,
  hatchRef,
  patternId,
  tabIndex,
  registerRef,
  onFocus,
}: PositionBarProps): ReactElement {
  const slotStart = index * slot
  const emptyFuture = position.isFuture && position.values.every((v) => v === null || v === 0)
  const classes = [
    'bar-chart-position',
    position.isFuture ? 'bar-chart-position-future' : '',
    position.isPartlyFuture ? 'bar-chart-position-partly' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const groupHeight = barThickness * series.length
  const groupStart = slotStart + (slot - groupHeight) / 2

  return (
    <g
      ref={registerRef}
      role="img"
      aria-label={position.ariaLabel}
      tabIndex={tabIndex}
      className={classes}
      onFocus={onFocus}
    >
      {isRows ? (
        <rect className="bar-chart-hit" x={0} y={slotStart} width={LABEL_PX + AXIS_PX} height={slot} />
      ) : (
        <rect className="bar-chart-hit" x={slotStart} y={0} width={slot} height={AXIS_PX + 24} />
      )}
      {isRows ? (
        <text className="bar-chart-day-label" x={0} y={slotStart + slot / 2}>
          {position.label}
        </text>
      ) : (
        <text
          className="bar-chart-day-label"
          x={slotStart + slot / 2}
          y={AXIS_PX + 16}
          textAnchor="middle"
        >
          {position.label}
        </text>
      )}
      {emptyFuture ? (
        isRows ? (
          <>
            <rect
              className="bar-chart-future-fill"
              x={LABEL_PX}
              y={groupStart}
              width={AXIS_PX}
              height={groupHeight}
              fill={hatchRef}
            />
            <text className="bar-chart-future-text" x={LABEL_PX + 8} y={slotStart + slot / 2}>
              future
            </text>
          </>
        ) : (
          <>
            <rect
              className="bar-chart-future-fill"
              x={groupStart}
              y={0}
              width={groupHeight}
              height={AXIS_PX}
              fill={hatchRef}
            />
            <text className="bar-chart-future-text" x={slotStart + slot / 2} y={AXIS_PX - 8}>
              future
            </text>
          </>
        )
      ) : (
        series.map((s, i) => {
          const raw = position.values[i]
          if (raw === null || raw === undefined) return null
          const value = Number(raw)
          const length = Math.abs(value) * scale.pxPerUnit
          const fill = s.marker === 'solid' ? undefined : `url(#${patternId(s.marker)})`
          // Single-series charts colour negative bars red; with several series a red
          // outline marks them so the series colour and pattern stay readable.
          const negative = value < 0
          const base = s.marker === 'solid' ? `bar-chart-bar bar-chart-series-${i % 6}` : 'bar-chart-bar'
          const className = negative
            ? `${base} ${series.length === 1 ? 'bar-chart-negative' : 'bar-chart-negative-multi'}`
            : base
          const offset = groupStart + i * barThickness
          if (isRows) {
            const x = value >= 0 ? baseline : baseline - length
            return (
              <rect key={s.id} className={className} fill={fill} x={x} y={offset} width={length} height={barThickness - 2} />
            )
          }
          const y = value >= 0 ? baseline - length : baseline
          return (
            <rect key={s.id} className={className} fill={fill} x={offset} y={y} width={barThickness - 2} height={length} />
          )
        })
      )}
      {position.goal !== null && scale.pxPerUnit > 0 ? (
        <GoalLine
          isRows={isRows}
          at={goalAxis(isRows, scale.zeroPx, position.goal.value, scale.pxPerUnit)}
          from={slotStart}
          to={slotStart + slot}
        />
      ) : null}
    </g>
  )
}
