/**
 * `EntryEditor` — records, edits and removes the Daily_Entries of one Activity
 * on one Day (Req 3, 4, 14.1, 14.13-14.16, 14.18-14.20).
 *
 * A Day can hold several entries, one per Tag_Combination: the untagged entry
 * (what earlier versions stored as the Day's value) and any number of tagged
 * ones. The list shows each entry with its tags; "Edit" loads it into the form
 * below, tagged entries can be removed, and saving the form upserts the entry for
 * its combination (same tags in any order or case replace the existing entry).
 * The Day's total is the sum of its entries.
 *
 * Parsing, validation, spelling adoption and persistence are done by
 * `applyCommand` via `recordValue` / `removeEntry`. On a rejected or unsaved
 * change the input, including the tags, is kept and the message is shown next to
 * the field it concerns (Req 14.20). When no `date` is given the user picks the
 * Day with a date field whose `max` is today; a Day after today is also refused
 * in code (Req 3.5, 4.6, 14.19).
 */
import { useId, useMemo, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { compareDates } from '../domain/calendar'
import type { LocalDate } from '../domain/calendar'
import { dayEntries, dayTotal, emptyDataset } from '../domain/dataset'
import { formatMilli } from '../domain/decimal'
import { tagLibrary } from '../domain/tags'
import { useNumberDisplay } from '../state/useNumberDisplay'
import { useTrackerActions, useTrackerSnapshot } from '../state/useTracker'
import { DecimalInput } from './DecimalInput'
import { TagInput } from './TagInput'
import {
  COMMIT_FAILED_MESSAGE,
  FUTURE_DATE_MESSAGE,
  RECOVERY_WRITE_MESSAGE,
  commandErrorMessage,
} from './messages'

export interface EntryEditorProps {
  activityId: string
  /** Fixed Day; when omitted the user picks the Day (default today). */
  date?: LocalDate
  onClose?: () => void
  autoFocus?: boolean
}

export function EntryEditor({ activityId, date, onClose, autoFocus = false }: EntryEditorProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const { recordValue, removeEntry } = useTrackerActions()
  const fmt = useNumberDisplay()
  const today = snapshot.today
  const dataset = snapshot.load.phase === 'ready' ? snapshot.load.dataset : emptyDataset()
  const library = useMemo(() => tagLibrary(dataset), [dataset])

  const [picked, setPicked] = useState<LocalDate>(date ?? today)
  const selectedDate = date ?? picked
  const isFuture = compareDates(selectedDate, today) > 0
  const [tags, setTags] = useState<string[]>([])
  const [pending, setPending] = useState('')
  const [valueText, setValueText] = useState('')
  const [valueError, setValueError] = useState<string | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const dateId = useId()

  const entries = dayEntries(dataset, activityId, selectedDate)
  const total = dayTotal(dataset, activityId, selectedDate)

  const clearErrors = (): void => {
    setValueError(null)
    setTagError(null)
    setGeneralError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    clearErrors()
    if (isFuture) {
      setGeneralError(FUTURE_DATE_MESSAGE)
      return
    }
    // A tag typed but not yet committed with Enter is part of the entry.
    const allTags = pending.trim() === '' ? tags : [...tags, pending.trim()]
    setBusy(true)
    const result = await recordValue(activityId, selectedDate, valueText, allTags)
    setBusy(false)
    if (result.status === 'saved') {
      setTags([])
      setPending('')
      setValueText('')
      return
    }
    if (result.status === 'rejected') {
      const message = commandErrorMessage(result.error)
      if (result.error.field === 'tags') setTagError(message)
      else if (result.error.field === 'value') setValueError(message)
      else setGeneralError(message)
      return
    }
    setGeneralError(result.reason === 'recovery' ? RECOVERY_WRITE_MESSAGE : COMMIT_FAILED_MESSAGE)
  }

  const handleRemove = async (entryTags: readonly string[]): Promise<void> => {
    clearErrors()
    const result = await removeEntry(activityId, selectedDate, [...entryTags])
    if (result.status === 'notSaved') {
      setGeneralError(result.reason === 'recovery' ? RECOVERY_WRITE_MESSAGE : COMMIT_FAILED_MESSAGE)
    }
  }

  const handleEdit = (entryTags: readonly string[], value: number): void => {
    clearErrors()
    setTags([...entryTags])
    setPending('')
    setValueText(formatMilli(value))
  }

  return (
    <section className="entry-editor" aria-label="Daily entries">
      {date === undefined ? (
        <div className="value-entry-date">
          <label className="value-entry-date-label" htmlFor={dateId}>
            Day
          </label>
          <input
            id={dateId}
            className="value-entry-date-field"
            type="date"
            max={today}
            value={selectedDate}
            onChange={(event) => {
              setPicked(event.currentTarget.value)
              clearErrors()
            }}
          />
        </div>
      ) : null}

      <p className="entry-editor-total">
        Day total: <strong>{fmt.value(total)}</strong>
      </p>
      {entries.length === 0 ? (
        <p className="entry-editor-empty">No entries for this day.</p>
      ) : (
        <ul className="entry-list">
          {entries.map((entry) => (
            <li key={entry.tags.join('\u001f')} className="entry-row">
              <span className="entry-row-tags">
                {entry.tags.length === 0 ? (
                  <span className="entry-row-untagged">Not tagged</span>
                ) : (
                  entry.tags.map((tag) => (
                    <span key={tag} className="tag-chip tag-chip-static">
                      {tag}
                    </span>
                  ))
                )}
              </span>
              <span className="entry-row-value">{fmt.value(entry.value)}</span>
              <button
                type="button"
                className="entry-row-edit"
                disabled={isFuture}
                onClick={() => handleEdit(entry.tags, entry.value)}
              >
                Edit
              </button>
              {entry.tags.length > 0 ? (
                <button
                  type="button"
                  className="entry-row-remove"
                  disabled={isFuture}
                  aria-label={`Remove entry ${entry.tags.join(', ')}`}
                  onClick={() => void handleRemove(entry.tags)}
                >
                  Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <form className="value-entry entry-editor-form" onSubmit={handleSubmit} noValidate>
        <TagInput
          tags={tags}
          onChange={(next) => {
            setTags(next)
            setTagError(null)
          }}
          text={pending}
          onTextChange={setPending}
          library={library}
          error={tagError}
          disabled={isFuture || busy}
        />
        <DecimalInput
          allowNegative
          label="Value"
          value={valueText}
          onChange={(next) => {
            setValueText(next)
            setValueError(null)
          }}
          error={valueError}
          disabled={isFuture || busy}
          autoFocus={autoFocus}
        />
        {generalError !== null ? (
          <p className="entry-editor-error" role="alert">
            {generalError}
          </p>
        ) : null}
        <div className="value-entry-actions">
          <button type="submit" className="value-entry-save" disabled={isFuture || busy}>
            Save entry
          </button>
          {onClose === undefined ? null : (
            <button type="button" className="value-entry-cancel" onClick={onClose} disabled={busy}>
              Close
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
