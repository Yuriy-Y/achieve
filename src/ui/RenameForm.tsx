/**
 * `RenameForm` — rename an existing Activity (design: UI components —
 * `ActivityForm` / `RenameForm`).
 *
 * A single name field, prefilled with the Activity's current name, lets the
 * user change it. Submitting calls `renameActivity(id, name)` from
 * `useTrackerActions`; the store trims and validates the raw string in the
 * domain layer, excluding this Activity from the duplicate check so renaming to
 * the same name is accepted (Req 1.4, 1.6).
 *
 * The store returns a `CommandResult`:
 * - `saved`: the rename succeeded. The form calls `onRenamed` so the parent can
 *   close it (Req 1.6).
 * - `rejected`: `applyCommand` refused the command. The name `CommandError`
 *   (`required` / `tooLong` / `duplicate`) is shown via `src/ui/messages.ts`
 *   and the entered text is kept (Req 1.2–1.5).
 * - `notSaved`: a commit failed or the Tracker is in recovery mode. The entered
 *   text is kept and the parent (`App`) surfaces the shared notice (Req 1.10,
 *   9.14). This form only closes on `saved`.
 *
 * The name field is a plain labelled `<input type="text">` with its error
 * linked by `aria-describedby` / `aria-invalid`. No inline styles are used
 * (CSP `style-src 'self'`); the 44px touch targets come from the task-14
 * stylesheet via `className`.
 */

import { useId, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'

import type { CommandError } from '../domain/commands'
import { useTrackerActions } from '../state/useTracker'
import { nameErrorMessage, BUTTON_LABELS } from './messages'

/** Props for {@link RenameForm}. */
export interface RenameFormProps {
  /** Id of the Activity being renamed. */
  activityId: string
  /** The Activity's current name, used to prefill the field. */
  currentName: string
  /** Called after the Activity is renamed so the parent can close the form. */
  onRenamed: () => void
  /** Called when the user cancels; the parent closes the form. */
  onCancel: () => void
}

/**
 * The rename form. Prefills the name field with `currentName`, keeps the
 * entered text across a rejected or not-saved submit, and closes only after a
 * successful rename.
 */
export function RenameForm({
  activityId,
  currentName,
  onRenamed,
  onCancel,
}: RenameFormProps): ReactElement {
  const { renameActivity } = useTrackerActions()

  const [name, setName] = useState(currentName)
  const [error, setError] = useState<CommandError | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const nameId = useId()
  const nameErrorId = `${nameId}-error`

  const nameErrorText =
    error !== null && error.field === 'name' ? nameErrorMessage(error.code) : null
  const hasNameError = nameErrorText !== null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (submitting) return
    setSubmitting(true)
    const result = await renameActivity(activityId, name)
    setSubmitting(false)

    if (result.status === 'saved') {
      setError(null)
      onRenamed()
      return
    }

    if (result.status === 'rejected') {
      // Keep the entered text and show the field error (Req 1.5).
      setError(result.error)
      return
    }

    // notSaved (commit failure or recovery mode): keep the input; the shared
    // notice is shown by App. Clear any stale field error (Req 1.10, 9.14).
    setError(null)
  }

  return (
    <form className="rename-form" onSubmit={handleSubmit} noValidate>
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

      <div className="rename-form-actions">
        <button
          type="button"
          className="form-button form-button-cancel"
          onClick={onCancel}
          disabled={submitting}
        >
          {BUTTON_LABELS.cancel}
        </button>
        <button type="submit" className="form-button form-button-submit" disabled={submitting}>
          Save
        </button>
      </div>
    </form>
  )
}
