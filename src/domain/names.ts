/**
 * Activity name validation and normalisation (pure functions).
 *
 * Covers the design's "Domain: names.ts" section and Requirements 1.2, 1.3,
 * 1.4 (rejected by Property 3):
 *   - trim leading/trailing whitespace,
 *   - reject empty / whitespace-only names (`required`),
 *   - reject names longer than 100 Unicode code points (`tooLong`),
 *   - reject names that duplicate another Activity's name case-insensitively
 *     (`duplicate`), excluding the Activity being renamed.
 *
 * Comparison rules (from the design):
 *   - Case-insensitive comparison uses `toLocaleLowerCase('en')` on trimmed
 *     names so uniqueness is stable regardless of the Device_Locale.
 *   - Length counts Unicode code points via `Array.from`, so an emoji counts
 *     as a single character.
 *
 * The same function is used by `datasetRules` for load and import validation
 * (Requirement 12.8).
 */
import type { Result } from './result'
import { err, ok } from './result'

/** Maximum Activity name length, counted in Unicode code points. */
export const NAME_MAX = 100

/** Validation failure codes for an Activity name. */
export type NameError = 'required' | 'tooLong' | 'duplicate'

/**
 * Minimal shape read by name validation: an Activity's stable `id` (used to
 * exclude the Activity being renamed) and its `name`. A full `Activity`
 * (defined in `dataset.ts`) is structurally assignable to this type.
 */
export interface NamedActivity {
  id: string
  name: string
}

/** Length in Unicode code points (so an astral-plane emoji counts as one). */
function codePointLength(value: string): number {
  return Array.from(value).length
}

/** Canonical form used for case-insensitive uniqueness comparison. */
function normaliseForComparison(trimmedName: string): string {
  return trimmedName.toLocaleLowerCase('en')
}

/**
 * Validate and normalise an Activity name for creation or rename.
 *
 * On success returns the trimmed name. On failure returns the first problem
 * found, checked in the order: `required`, then `tooLong`, then `duplicate`.
 *
 * @param raw        The raw name as entered by the user (untrimmed).
 * @param activities Existing Activities to check uniqueness against.
 * @param excludeId  Id of the Activity being renamed, excluded from the
 *                   duplicate check so renaming to the same name is allowed.
 */
export function validateActivityName(
  raw: string,
  activities: readonly NamedActivity[],
  excludeId?: string,
): Result<string, NameError> {
  const trimmed = raw.trim()

  if (trimmed.length === 0) {
    return err('required')
  }

  if (codePointLength(trimmed) > NAME_MAX) {
    return err('tooLong')
  }

  const candidate = normaliseForComparison(trimmed)
  const duplicate = activities.some(
    (activity) =>
      activity.id !== excludeId &&
      normaliseForComparison(activity.name.trim()) === candidate,
  )

  if (duplicate) {
    return err('duplicate')
  }

  return ok(trimmed)
}
