/**
 * `BarChart` — the accessible SVG bar chart for one Activity's selected Period
 * (design: UI components — `BarChart` / `useChartLayout`, and the Overview's
 * "Accessible custom SVG chart" decision).
 *
 * Why SVG and not a canvas chart: Requirement 5.9 needs every Day position to
 * be keyboard-focusable with its own accessible label, and Req 11.2 needs each
 * position to be a 44x44 CSS-pixel Touch_Target. A canvas chart (Chart.js) draws
 * bars that are not focusable DOM nodes, so this is a small hand-written SVG
 * where each Day is a focusable `<g role="img">` carrying the position's
 * `ariaLabel` from the `ChartModel` (Req 5.9).
 *
 * Bar geometry under the CSP (design: "express bar sizes with ... an SVG with
 * width/height attributes which are allowed as presentation attributes, NOT the
 * style attribute"). The app's CSP is `style-src 'self'` with no
 * `'unsafe-inline'`, so React `style={{...}}` inline styles are forbidden
 * everywhere (asserted by task 14.3). Variable bar sizes are therefore expressed
 * purely through SVG element geometry attributes — `x`, `y`, `width`, `height`
 * and `points` — which are presentation attributes, not the `style` attribute.
 * Colours, hatching and the 44px hit area come from CSS classes in the task-14
 * stylesheet. No element in this component carries a `style` attribute.
 *
 * Orientation (Req 5.12-5.15): the orientation ('rows' | 'columns') is resolved
 * by `useChartLayout` from the viewport and the measured container width via the
 * pure `chartOrientation` rule. Rows draw the first Day at the top and grow
 * bars rightwards; columns draw the first Day on the left and grow bars upwards.
 * Both read from the model's ascending `positions`, so Day order is preserved
 * (Req 5.12, 5.13). Every position keeps a 44px slot in both layouts (Req 5.15,
 * 11.2); in rows the SVG is as wide as the container and tall enough for all
 * Days, in columns as tall as a fixed band and wide enough for all Days, so the
 * chart never needs horizontal scrolling (Req 11.1).
 *
 * Keyboard (Req 5.9, design "roving tabindex with arrow keys ... Home, End"):
 * exactly one position is in the tab order at a time (roving `tabindex`). Arrow
 * keys move focus between Days — Up/Down in rows, Left/Right in columns, and the
 * cross-axis arrows are also accepted so either pair works — and Home/End jump
 * to the first/last Day. Future Days are rendered distinctly (hatched, with a
 * "future" text marker) and are non-interactive: they are still focusable and
 * labelled for screen readers but carry no value bar to act on (Req 5.6).
 *
 * This component is a pure presenter of a `ChartModel`: it recomputes none of
 * the domain logic (values, future flags, labels, goal, titles all come from
 * the model) and renders no numbers of its own beyond what the model provides.
 */
import { useCallback, useId, useRef, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'

import type { ChartModel, ChartPosition } from '../domain/viewModels'
import { TOUCH_MIN_PX } from '../domain/viewModels'
import { useChartLayout } from './useChartLayout'

/** Props for {@link BarChart}. */
export interface BarChartProps {
  /** The chart model for the selected Activity and Period. */
  model: ChartModel
}

/** Fixed slot size per Day in CSS pixels (the Touch_Target minimum, Req 11.2). */
const SLOT_PX = TOUCH_MIN_PX
/** Length of the value axis (bar growth direction) in CSS pixels. */
const AXIS_PX = 240
/** Padding reserved at the start of the value axis for the Day label text. */
const LABEL_PX = 112
/** Thickness of the drawn bar within its 44px slot, in CSS pixels. */
const BAR_THICKNESS_PX = 28

/**
 * The largest value to scale bars against: the Period's Effective_Goal when one
 * applies, otherwise the largest plotted value. A zero maximum (no goal, no
 * values) scales everything to zero-length bars.
 */
function scaleMax(model: ChartModel): number {
  let max = model.goal?.goal ?? 0
  for (const position of model.positions) {
    if (position.value !== null && position.value > max) {
      max = position.value
    }
  }
  return max
}

/** Bar length in CSS pixels for a value, clamped to the axis length. */
function barLength(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0
  const length = (value / max) * AXIS_PX
  return length > AXIS_PX ? AXIS_PX : length
}

/** The goal marker offset along the value axis, or `null` when no goal applies. */
function goalOffset(model: ChartModel, max: number): number | null {
  if (model.goal === null) return null
  if (max <= 0) return 0
  const offset = (model.goal.goal / max) * AXIS_PX
  return offset > AXIS_PX ? AXIS_PX : offset
}

export function BarChart({ model }: BarChartProps): ReactElement {
  const { positions } = model
  const { containerRef, orientation } = useChartLayout(positions.length)
  const [focusIndex, setFocusIndex] = useState(0)
  const groupsRef = useRef<Array<SVGGElement | null>>([])
  const titleId = useId()
  const hatchId = useId()

  // Move focus to a Day position, keeping the roving tabindex in step.
  const focusAt = useCallback((index: number, count: number): void => {
    if (count === 0) return
    const clamped = index < 0 ? 0 : index >= count ? count - 1 : index
    setFocusIndex(clamped)
    groupsRef.current[clamped]?.focus()
  }, [])

  // Arrow keys move between Days (Up/Down for rows, Left/Right for columns; the
  // cross-axis arrows are also accepted). Home/End jump to the first/last Day.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SVGSVGElement>): void => {
      const count = positions.length
      if (count === 0) return
      let next: number | null = null
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
    },
    [focusIndex, positions.length, focusAt],
  )

  const max = scaleMax(model)
  const isRows = orientation === 'rows'
  const count = positions.length

  // SVG canvas size. Rows: value axis horizontal, one 44px row per Day.
  // Columns: value axis vertical, one 44px column per Day.
  const totalAxis = LABEL_PX + AXIS_PX
  const svgWidth = isRows ? totalAxis : count * SLOT_PX
  const svgHeight = isRows ? count * SLOT_PX : totalAxis
  const marker = goalOffset(model, max)

  return (
    <div className="bar-chart" ref={containerRef}>
      <p className="bar-chart-title">{model.title}</p>
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
          {/* Hatch pattern for future Days (Req 5.6); colour comes from CSS. */}
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
        </defs>

        {/* Goal marker: a line across the value axis at the Effective_Goal. */}
        {marker !== null ? (
          isRows ? (
            <line
              className="bar-chart-goal-line"
              x1={LABEL_PX + marker}
              y1={0}
              x2={LABEL_PX + marker}
              y2={svgHeight}
            />
          ) : (
            <line
              className="bar-chart-goal-line"
              x1={0}
              y1={AXIS_PX - marker}
              x2={svgWidth}
              y2={AXIS_PX - marker}
            />
          )
        ) : null}

        {positions.map((position, index) => (
          <PositionBar
            key={position.date}
            position={position}
            index={index}
            isRows={isRows}
            max={max}
            hatchRef={`url(#${hatchId})`}
            tabIndex={index === focusIndex ? 0 : -1}
            registerRef={(el) => {
              groupsRef.current[index] = el
            }}
            onFocus={() => setFocusIndex(index)}
          />
        ))}
      </svg>
    </div>
  )
}

/** Props for one Day position within the chart. */
interface PositionBarProps {
  position: ChartPosition
  index: number
  isRows: boolean
  max: number
  hatchRef: string
  tabIndex: number
  registerRef: (element: SVGGElement | null) => void
  onFocus: () => void
}

/**
 * One Day position: a focusable, labelled `<g role="img">` holding the 44px hit
 * area, the value bar (or the hatched "future" marker) and the Day's short
 * label. All geometry is set through SVG attributes, never the `style`
 * attribute, so the CSP's `style-src 'self'` is respected.
 */
function PositionBar({
  position,
  index,
  isRows,
  max,
  hatchRef,
  tabIndex,
  registerRef,
  onFocus,
}: PositionBarProps): ReactElement {
  const slotStart = index * SLOT_PX
  const barPad = (SLOT_PX - BAR_THICKNESS_PX) / 2
  const value = position.value ?? 0
  const length = barLength(value, max)
  const futureClass = position.isFuture ? ' bar-chart-position-future' : ''

  if (isRows) {
    // Rows: Day label on the left, bar grows to the right along the x axis.
    const barY = slotStart + barPad
    return (
      <g
        ref={registerRef}
        role="img"
        aria-label={position.ariaLabel}
        tabIndex={tabIndex}
        className={`bar-chart-position${futureClass}`}
        onFocus={onFocus}
      >
        {/* Transparent 44px hit area for the Touch_Target (Req 11.2). */}
        <rect
          className="bar-chart-hit"
          x={0}
          y={slotStart}
          width={LABEL_PX + AXIS_PX}
          height={SLOT_PX}
        />
        <text className="bar-chart-day-label" x={0} y={slotStart + SLOT_PX / 2}>
          {shortDay(position.date)}
        </text>
        {position.isFuture ? (
          <>
            <rect
              className="bar-chart-future-fill"
              x={LABEL_PX}
              y={barY}
              width={AXIS_PX}
              height={BAR_THICKNESS_PX}
              fill={hatchRef}
            />
            <text className="bar-chart-future-text" x={LABEL_PX + 8} y={slotStart + SLOT_PX / 2}>
              future
            </text>
          </>
        ) : (
          <rect
            className="bar-chart-bar"
            x={LABEL_PX}
            y={barY}
            width={length}
            height={BAR_THICKNESS_PX}
          />
        )}
      </g>
    )
  }

  // Columns: Day label at the bottom, bar grows upwards along the y axis.
  const barX = slotStart + barPad
  return (
    <g
      ref={registerRef}
      role="img"
      aria-label={position.ariaLabel}
      tabIndex={tabIndex}
      className={`bar-chart-position${futureClass}`}
      onFocus={onFocus}
    >
      <rect className="bar-chart-hit" x={slotStart} y={0} width={SLOT_PX} height={LABEL_PX + AXIS_PX} />
      <text className="bar-chart-day-label" x={slotStart + SLOT_PX / 2} y={AXIS_PX + 16}>
        {shortDay(position.date)}
      </text>
      {position.isFuture ? (
        <>
          <rect
            className="bar-chart-future-fill"
            x={barX}
            y={0}
            width={BAR_THICKNESS_PX}
            height={AXIS_PX}
            fill={hatchRef}
          />
          <text
            className="bar-chart-future-text"
            x={slotStart + SLOT_PX / 2}
            y={AXIS_PX - 8}
          >
            future
          </text>
        </>
      ) : (
        <rect
          className="bar-chart-bar"
          x={barX}
          y={AXIS_PX - length}
          width={BAR_THICKNESS_PX}
          height={length}
        />
      )}
    </g>
  )
}

/** Day-of-month number for the compact in-chart label (full date is in the aria-label). */
function shortDay(date: string): string {
  return String(Number(date.slice(8, 10)))
}
