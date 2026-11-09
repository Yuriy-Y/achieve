/**
 * `GoalPanel` — set, change and remove the weekly and monthly Goal of one
 * Activity, and show the current Goal for each type (design: UI components —
 * `GoalPanel / GoalHistory`, Req 6.1, 6.2, 6.5, 6.6, 6.7, 6.9, 8.1-8.5, 8.9,
 * 8.13).
 *
 * The panel renders one sub-form per Goal type (weekly and monthly). For each
 * type it shows the current Effective_Goal of the Current_Period together with
 * its Goal_Progress and Goal_Status when one applies, or a "no goal set" note
 * otherwise (Req 6.9). Below that sits a `DecimalInput` for a Valid_Goal_Value
 * (0.001..999,999,999.999, at most 3 decimals, "." or "," as decimal
 * separator — all enforced by the domain's `parseGoalValue`), a Set/Change
 * button, and a Remove button shown only while an Effective_Goal exists for the
 * Current_Period.
 *
 * All Goal arithmetic and versioning lives in the domain and store layers: the
 * buttons call `setGoal(id, type, value)` / `removeGoal(id, type)`, which the
 * store turns into a Goal_Version at the Current_Period of that type and
 * persists, so a change applies from the Current_Period forward while earlier
 * Periods keep their Goal (Req 6.5, 6.6, 8.1-8.5). This component only inspects
 * the returned `CommandResult`:
 *   - `saved`: clear the input field (Req 8.13 wording — input kept only on
 *     failure); the current-goal display refreshes from the new snapshot.
 *   - `rejected`: show the field-level validation message from `messages.ts`
 *     and keep the entered text (Req 6.7).
 *   - `notSaved`: keep the input; the store surfaces the persist/recovery
 *     message through the shared `Notifications` region (Req 8.13, 9.14).
 *
 * Current-goal numbers (the Effective_Goal value and the Goal_Progress) are
 * formatted in the Device_Locale through the shared `NumberDisplay` (Req 7.1,
 * 11.12). All sizing (44px touch targets) comes from CSS classes (task-14
 * stylesheet); no inline styles are used (CSP `style-src 'self'`).
 */

import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import type { GoalType, LocalDate, Period } from '../domain/calendar'
import { currentPeriod } from '../domain/calendar'
import type { Dataset } from '../domain/dataset'
import { resolveEffectiveGoal } from '../domain/goals'
import type { NumberDisplay } from '../domain/numberFormat'
import { goalProgressTenths, goalStatus } from '../domain/stats'
import { periodTotal } from '../domain/stats'
import type { CommandResult } from '../state/TrackerStore'
import { DecimalInput } from './DecimalInput'
import { GoalHistory } from './GoalHistory'
import { commandErrorMessage } from './messages'

/** Props for {@link GoalPanel}. */
export interface GoalPanelProps {
  /** The current Data_Set, from the active snapshot. */
  dataset: Dataset
  /** The Activity whose Goals are managed. */
  activityId: string
  /** The Activity name, used to label the Goal fields accessibly. */
  activityName: string
  /** Today's Day, which fixes the Current_Period of each Goal type. */
  today: LocalDate
  /** Locale formatter for the current-goal display (Req 7.1, 11.12). */
  fmt: NumberDisplay
  /** Set or change a Goal of the given type (wired to `useTrackerActions`). */
  onSetGoal: (activityId: string, goalType: GoalType, value: string) => Promise<CommandResult>
  /** Remove a Goal of the given type (wired to `useTrackerActions`). */
  onRemoveGoal: (activityId: string, goalType: GoalType) => Promise<CommandResult>
}

/** The two Goal types in a fixed order (weekly before monthly). */
const GOAL_TYPES: readonly GoalType[] = ['weekly', 'monthly']

/**
 * Goal management panel for one Activity: a sub-form per Goal type plus the
 * Goal history. Controlled by local input state; delegates parse, validate,
 * version and persist to the store.
 */
export function GoalPanel({
  dataset,
  activityId,
  activityName,
  today,
  fmt,
  onSetGoal,
  onRemoveGoal,
}: GoalPanelProps): ReactElement {
  return (
    <section className="goal-panel" aria-label={`Goals for ${activityName}`}>
      <h2 className="goal-panel-title">Goals</h2>
      {GOAL_TYPES.map((goalType) => (
        <GoalTypeForm
          key={goalType}
          dataset={dataset}
          activityId={activityId}
          activityName={activityName}
          goalType={goalType}
          today={today}
          fmt={fmt}
          onSetGoal={onSetGoal}
          onRemoveGoal={onRemoveGoal}
        />
      ))}
      <GoalHistory goalVersions={dataset.goalVersions} activityId={activityId} fmt={fmt} />
    </section>
  )
}

/** Props for one {@link GoalTypeForm}. */
interface GoalTypeFormProps {
  dataset: Dataset
  activityId: string
  activityName: string
  goalType: GoalType
  today: LocalDate
  fmt: NumberDisplay
  onSetGoal: (activityId: string, goalType: GoalType, value: string) => Promise<CommandResult>
  onRemoveGoal: (activityId: string, goalType: GoalType) => Promise<CommandResult>
}

/**
 * One Goal type's sub-form: the current Effective_Goal (with progress/status
 * when present), a value field, and Set/Change plus Remove actions.
 */
function GoalTypeForm({
  dataset,
  activityId,
  activityName,
  goalType,
  today,
  fmt,
  onSetGoal,
  onRemoveGoal,
}: GoalTypeFormProps): ReactElement {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const period = currentPeriod(today, goalType)
  // The Effective_Goal for the Current_Period of this type, or null when none
  // applies (Req 6.1, 6.9).
  const effectiveGoal = resolveEffectiveGoal(dataset.goalVersions, activityId, period)
  const hasGoal = effectiveGoal !== null

  const handleChange = (value: string): void => {
    setText(value)
    // Clear a stale validation message as soon as the user edits the field.
    if (error !== null) setError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const result = await onSetGoal(activityId, goalType, text)
    if (result.status === 'saved') {
      // The current-goal display refreshes from the new snapshot; clear input.
      setText('')
      setError(null)
      return
    }
    if (result.status === 'rejected') {
      // Keep the entered text and show the field error (Req 6.7).
      setError(commandErrorMessage(result.error))
      return
    }
    // notSaved: commit failure or recovery mode. Keep the input; the store's
    // notice drives the shared live-region message (Req 8.13, 9.14).
  }

  const handleRemove = async (): Promise<void> => {
    // removeGoal carries no user input, so there is nothing to keep on failure;
    // a rejected/notSaved outcome is surfaced by the shared Notifications
    // region. A successful removal refreshes the display from the new snapshot.
    await onRemoveGoal(activityId, goalType)
  }

  const label = goalType === 'weekly' ? 'Weekly goal' : 'Monthly goal'
  const typeName = goalType === 'weekly' ? 'weekly' : 'monthly'

  return (
    <form
      className="goal-type-form"
      onSubmit={handleSubmit}
      aria-label={`${label} for ${activityName}`}
    >
      <h3 className="goal-type-title">{label}</h3>
      <p className="goal-type-current">
        {hasGoal ? (
          <CurrentGoal effectiveGoal={effectiveGoal} progressText={progressTextFor(dataset, activityId, period, effectiveGoal, fmt)} statusText={statusTextFor(dataset, activityId, period, effectiveGoal, today)} fmt={fmt} />
        ) : (
          <span className="goal-type-none">No {typeName} goal set.</span>
        )}
      </p>
      <DecimalInput
        label={`${label} value for ${activityName}`}
        value={text}
        onChange={handleChange}
        error={error}
        placeholder="e.g. 50"
      />
      <div className="goal-type-actions">
        <button type="submit" className="goal-set">
          {hasGoal ? 'Change goal' : 'Set goal'}
        </button>
        {hasGoal ? (
          <button type="button" className="goal-remove" onClick={handleRemove}>
            Remove goal
          </button>
        ) : null}
      </div>
    </form>
  )
}

/** Props for the current-goal display row. */
interface CurrentGoalProps {
  effectiveGoal: number
  progressText: string
  statusText: string
  fmt: NumberDisplay
}

/** Renders the current Effective_Goal value with its progress and status. */
function CurrentGoal({ effectiveGoal, progressText, statusText, fmt }: CurrentGoalProps): ReactElement {
  return (
    <>
      <span className="goal-type-value">Goal {fmt.value(effectiveGoal)}</span>
      <span className="goal-type-progress">{progressText}</span>
      <span className="goal-type-status">{statusText}</span>
    </>
  )
}

/** Device_Locale Goal_Progress text for the Current_Period against the goal. */
function progressTextFor(
  dataset: Dataset,
  activityId: string,
  period: Period,
  goal: number,
  fmt: NumberDisplay,
): string {
  const total = periodTotal(dataset.values, activityId, period)
  return fmt.progress(goalProgressTenths(total, goal))
}

/** Goal_Status text for the Current_Period against the goal (Req 8.9). */
function statusTextFor(
  dataset: Dataset,
  activityId: string,
  period: Period,
  goal: number,
  today: LocalDate,
): string {
  const total = periodTotal(dataset.values, activityId, period)
  return goalStatus(total, goal, period, today)
}
