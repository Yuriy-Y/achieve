/**
 * `TagInput` — the tag field of one Daily_Entry (Req 14.1-14.12).
 *
 * Attached tags are shown as chips with a 44 px remove button. A text field
 * follows the ARIA combobox pattern: typing shows `suggestTags` results from the
 * Tag_Library in a listbox (prefix matches first, then "contains"); focusing the
 * empty field proposes the most used tags (Req 14.9). Enter or "," commits the
 * typed text, Arrow keys move through suggestions, Escape closes the list and
 * Backspace on an empty field removes the last chip. The field is disabled once
 * 3 chips exist (Req 14.5).
 *
 * Validation (length, characters, duplicates, count) and the adoption of an
 * existing spelling happen in the domain (`resolveTags` inside `applyCommand`);
 * this component only keeps the list and shows the message it is given. Classes
 * only, no inline styles (CSP).
 */
import { useId, useMemo, useState } from 'react'
import type { KeyboardEvent, ReactElement } from 'react'
import { TAGS_PER_ENTRY_MAX, suggestTags, tagKey, type TagLibraryEntry } from '../domain/tags'

export interface TagInputProps {
  label?: string
  /** Attached tags in attach order. */
  tags: readonly string[]
  onChange: (tags: string[]) => void
  /** The Tag_Library used for suggestions. */
  library: readonly TagLibraryEntry[]
  error?: string | null
  disabled?: boolean
  /** The typed, not yet committed text; owned by the parent so a save can include and clear it. */
  text: string
  onTextChange: (text: string) => void
}

export function TagInput({
  label = 'Tags (optional)',
  tags,
  onChange,
  library,
  error = null,
  disabled = false,
  text,
  onTextChange,
}: TagInputProps): ReactElement {
  const id = useId()
  const listId = `${id}-list`
  const errorId = `${id}-error`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [localError, setLocalError] = useState<string | null>(null)

  const full = tags.length >= TAGS_PER_ENTRY_MAX
  const suggestions = useMemo(() => suggestTags(library, text, tags), [library, text, tags])
  const shownError = error ?? localError
  const showList = open && !full && suggestions.length > 0

  const add = (raw: string): void => {
    const trimmed = raw.trim()
    if (trimmed === '') return
    if (tags.some((t) => tagKey(t) === tagKey(trimmed))) {
      setLocalError('This tag is already attached.')
      return
    }
    if (tags.length >= TAGS_PER_ENTRY_MAX) {
      setLocalError('An entry can have at most 3 tags.')
      return
    }
    // Spelling is adopted from the library when the entry is saved; show it now too.
    const known = library.find((entry) => entry.key === tagKey(trimmed))
    setLocalError(null)
    onChange([...tags, known?.label ?? trimmed])
    onTextChange('')
    setActive(-1)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        if (suggestions.length === 0) return
        event.preventDefault()
        setOpen(true)
        setActive((i) => (i + 1) % suggestions.length)
        break
      case 'ArrowUp':
        if (suggestions.length === 0) return
        event.preventDefault()
        setOpen(true)
        setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1))
        break
      case 'Enter':
      case ',':
        if (event.key === 'Enter' && text.trim() === '' && active < 0) return // let the form submit
        event.preventDefault()
        add(showList && active >= 0 ? suggestions[active] : text)
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          setOpen(false)
          setActive(-1)
        }
        break
      case 'Backspace':
        if (text === '' && tags.length > 0) {
          onChange(tags.slice(0, -1))
          setLocalError(null)
        }
        break
      default:
    }
  }

  return (
    <div className="tag-input">
      <label className="tag-input-label" htmlFor={id}>
        {label}
      </label>
      <ul className="tag-input-chips" aria-label="Attached tags">
        {tags.map((tag) => (
          <li key={tagKey(tag)} className="tag-chip">
            <span className="tag-chip-text">{tag}</span>
            <button
              type="button"
              className="tag-chip-remove"
              aria-label={`Remove tag ${tag}`}
              disabled={disabled}
              onClick={() => onChange(tags.filter((t) => t !== tag))}
            >
              <span aria-hidden="true">{'\u00d7'}</span>
            </button>
          </li>
        ))}
      </ul>
      <input
        id={id}
        className="tag-input-field"
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${id}-opt-${active}` : undefined}
        aria-invalid={shownError !== null}
        aria-describedby={shownError !== null ? errorId : undefined}
        autoComplete="off"
        enterKeyHint="done"
        disabled={disabled || full}
        placeholder={full ? 'Maximum of 3 tags' : 'Add a tag'}
        value={text}
        onChange={(event) => {
          onTextChange(event.target.value)
          setOpen(true)
          setActive(-1)
          setLocalError(null)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Keep a typed tag instead of silently dropping it when leaving the field.
          setOpen(false)
        }}
        onKeyDown={handleKeyDown}
      />
      <ul
        id={listId}
        className="tag-suggestions"
        role="listbox"
        aria-label="Tag suggestions"
        hidden={!showList}
      >
        {suggestions.map((suggestion, index) => (
          <li
            key={suggestion}
            id={`${id}-opt-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? 'tag-suggestion tag-suggestion-active' : 'tag-suggestion'}
            // mousedown fires before the input blur, so the choice is not lost.
            onMouseDown={(event) => {
              event.preventDefault()
              add(suggestion)
            }}
          >
            {suggestion}
          </li>
        ))}
      </ul>
      {shownError !== null && shownError !== '' ? (
        <p id={errorId} className="tag-input-error" role="alert">
          {shownError}
        </p>
      ) : null}
    </div>
  )
}
