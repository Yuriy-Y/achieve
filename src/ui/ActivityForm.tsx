/**
 * `ActivityForm` — the create-Activity form (design: UI components —
 * `ActivityForm` / `RenameForm`).
 *
 * A single name field plus an optional Weekly_Goal and Monthly_Goal field lets
 * the user create an Activity with no goal, one goal, or both in one step
 * (Req 1.1, 6.2, 6.3, 6.4). Submitting calls
 * `createActivity(name, weeklyGoal?, monthlyGoal?)` from `useTrackerActions`,
 * which sends the raw strings straight to the store; all parsing, trimming and
 * validation stay in the domain layer (`applyCommand`), so this component never
 * decides what a valid name or goal is.
 *
 * The store returns a `CommandResult`:
 * - `saved`: the create succeeded. The form clears its fields and calls
 *   `onCreated` so the parent can close it (Req 1.1).
 * - `rejected`: `applyCommand` refused the command. The `CommandError`'s
 *   `field` selects which input shows the message (name `required` / `tooLong`
 *   / `duplicate`, Req 1.2–1.4; `weeklyGoal` / `monthlyGoal` goal `format` /
 *   `range`, Req 6.7, 6.8), the message comes from `src/ui/messages.ts`, and
 *   every entered value is kept (Req 1.5, 6.8).
 * - `notSaved`: a commit failed or the Tracker is in recovery mode. The entered
 *   input is kept; the parent (`App`) surfaces the shared notice (Req 1.10,
 *   9.14). This form only clears on `saved`.
 *
 * The name field is a plain labelled `<input type="text">`; the goal fields use
 * the shared `DecimalInput` primitive so the decimal keypad, accepted "," and
 * error wiring match the rest of the app (Req 11.3, 11.4). Each field links its
 * error with `aria-describedby` / `aria-invalid`. No inline styles are used
 * (CSP `style-src 'self'`); sizing and the 44px touch targets come from the
 * task-14 stylesheet via `className`.
 */

import { useId, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import type { CommandError } from '../domain/commands'
import { useTrackerActions } from '../state/useTracker'
import { DecimalInput } from './DecimalInput'
import { commandErrorMessage, nameErrorMessage, BUTTON_LABELS } from './messages'

/** Props for {@link ActivityForm}. */
export interface ActivityFormProps {
  /** Called after an Activity is created so the parent can close the form. */
  onCreated: () => void
  /** Called when the user cancels; the parent closes the form. */
  onCancel: () => void
}

/**
 * The create-Activity form. Holds the name and optional goal text in local
 * state, keeps that text across a rejected or not-saved submit, and clears it
 * only after a successful create.
 */
export function ActivityForm({ onCreated, onCancel }: ActivityFormProps): ReactElement {
  const { createActivity } = useTrackerActions()

  const [name, setName] = useState('')
  const [weeklyGoal, setWeeklyGoal] = useState('')
  const [monthlyGoal, setMonthlyGoal] = useState('')
  const [error, setError] = useState<CommandError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const nameId = useId()
  const nameErrorId = `${nameId}-error`

  // Only the error that matches each field is shown next to that field.
  const nameErrorText =
    error !== null && error.field === 'name' ? nameErrorMessage(error.code) : null
  const weeklyGoalErrorText =
    error !== null && error.field === 'weeklyGoal' ? commandErrorMessage(error) : null
  const monthlyGoalErrorText =
    error !== null && error.field === 'monthlyGoal' ? commandErrorMessage(error) : null

  const hasNameError = nameErrorText !== null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    const result = await createActivity(name, weeklyGoal, monthlyGoal)
    setSubmitting(false)

    if (result.status === 'saved') {
      // Clear the form and let the parent close it (Req 1.1).
      setName('')
      setWeeklyGoal('')
      setMonthlyGoal('')
      setError(null)
      onCreated()
      return
    }

    if (result.status === 'rejected') {
      // Keep every entered value and show the field error (Req 1.5, 6.8).
      setError(result.error)
      return
    }

    // notSaved (commit failure or recovery mode): keep the input; the shared
    // notice is shown by App. Clear any stale field error (Req 1.10, 9.14).
    setError(null)
  }

  return (
    <form className="activity-form" onSubmit={handleSubmit} noValidate>
      <div className="text-field">
        <label className="text-field-label" htmlFor={nameId}>
          Name
        </label>
        <input
          id={nameId}
          className="text-field-input"
          type="text"
          autoComplete="off"
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={hasNameError}
          aria-describedby={hasNameError ? nameErrorId : undefined}
        />
        {hasNameError ? (
          <p id={nameErrorId} className="text-field-error" role="alert">
            {nameErrorText}
          </p>
        ) : null}
      </div>

      <DecimalInput
        label="Weekly goal (optional)"
        value={weeklyGoal}
        onChange={setWeeklyGoal}
        error={weeklyGoalErrorText}
      />

      <DecimalInput
        label="Monthly goal (optional)"
        value={monthlyGoal}
        onChange={setMonthlyGoal}
        error={monthlyGoalErrorText}
      />

      <div className="activity-form-actions">
        <button
          type="button"
          className="form-button form-button-cancel"
          onClick={onCancel}
          disabled={submitting}
        >
          {BUTTON_LABELS.cancel}
        </button>
        <button type="submit" className="form-button form-button-submit" disabled={submitting}>
          Create activity
        </button>
      </div>
    </form>
  )
}
