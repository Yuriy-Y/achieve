/**
 * Centralised user-facing copy for the Achievement Tracker UI (design: Styling,
 * layout and theme — "Messages" table).
 *
 * The domain and store layers never hold display copy: they return typed codes
 * (a `CommandError`'s `field` + `code`, a `Notice.kind`, a `BackupError.code`,
 * a `DiscardError`). This module is the single place that turns those codes
 * into the exact sentences the design specifies, so wording stays consistent
 * across every component and is easy to review against the design in one file.
 *
 * Everything here is pure data / pure functions with no React, DOM or state
 * dependency, so it can be imported by any UI component and unit-tested
 * directly. The strings match the design's message table verbatim.
 */

import type { BackupError } from '../domain/backup'
import type { CommandError } from '../domain/commands'
import type { NameError } from '../domain/names'
import type { DiscardError } from '../storage/StoragePort'

/** Validation message for an Activity name error (Req 1.2, 1.3, 1.4). */
export function nameErrorMessage(code: NameError): string {
  switch (code) {
    case 'required':
      return 'Please enter a name.'
    case 'tooLong':
      return 'Names can be at most 100 characters.'
    case 'duplicate':
      return 'This name is already in use.'
  }
}

/**
 * Validation message for a Daily_Value input (Req 3.4, 4.5). Every `ParseError`
 * code (`empty`, `format`, `range`) maps to the same sentence stating the range
 * and decimal-place limit, as the design's table specifies, so no code argument
 * is needed.
 */
export const DAILY_VALUE_ERROR_MESSAGE =
  'Enter a number from 0 to 999,999.999 with at most 3 decimal places.'

/**
 * Validation message for a Goal value input (Req 6.7). Every `ParseError` code
 * maps to the same sentence stating the Goal range and decimal-place limit.
 */
export const GOAL_VALUE_ERROR_MESSAGE =
  'Enter a goal from 0.001 to 999,999,999.999 with at most 3 decimal places.'

/** Message shown when the user attempts to record a future Day (Req 3.5, 4.6). */
export const FUTURE_DATE_MESSAGE = 'Future days cannot be recorded.'

/**
 * Message for a `CommandError` returned by `applyCommand`, routed to the right
 * sentence by the error's `field` and `code` so a component can show it next to
 * the offending input (design: Error Handling). The `activity notFound` case
 * has no user-facing copy in the design's table (the UI closes the stale view
 * instead), so it maps to an empty string.
 */
export function commandErrorMessage(error: CommandError): string {
  switch (error.field) {
    case 'name':
      return nameErrorMessage(error.code)
    case 'value':
      return DAILY_VALUE_ERROR_MESSAGE
    case 'date':
      return FUTURE_DATE_MESSAGE
    case 'weeklyGoal':
    case 'monthlyGoal':
    case 'goal':
      return GOAL_VALUE_ERROR_MESSAGE
    case 'activity':
      return ''
  }
}

/** Message shown when a persist (commit) operation failed (Req 1.10, 3.8, 8.13, 9.7, 12.16). */
export const COMMIT_FAILED_MESSAGE = 'Your change was not saved. Please try again.'

/** Message shown when a change is attempted while in recovery mode (Req 9.14). */
export const RECOVERY_WRITE_MESSAGE =
  'Your change was not saved because your saved data could not be read. ' +
  'Import a backup or discard the unreadable data first.'

/** Startup banner shown when the persisted data could not be read (Req 9.4, 9.8). */
export const UNREADABLE_DATA_MESSAGE =
  'Saved data could not be read. The tracker started empty and your previous ' +
  'data was left untouched. You can import a backup or discard the unreadable ' +
  'data and start fresh.'

/** Confirmation prompt body shown before discarding unreadable data (Req 9.9). */
export const DISCARD_CONFIRM_MESSAGE =
  'Permanently delete the unreadable data? This cannot be undone. ' +
  'If you have a backup file, try Import backup first.'

/** Message for a failed or blocked discard of unreadable data (Req 9.13). */
export function discardErrorMessage(reason: DiscardError): string {
  switch (reason) {
    case 'failed':
      return 'The unreadable data was not discarded. Please try again.'
    case 'blocked':
      return (
        'The unreadable data was not discarded because the app is open in ' +
        'another window. Close other windows and try again.'
      )
  }
}

/**
 * Message for a rejected Backup_File import, routed by the `BackupError` code
 * (Req 12.9, 12.10). A `notJson`, `notBackup` or `invalid` error reports the
 * first validation problem found after the "not a valid backup file" prefix
 * (the design's table; `notJson` has no sub-problem so a generic reason is
 * used). An `unsupportedVersion` error names the version instead.
 */
export function backupErrorMessage(error: BackupError): string {
  switch (error.code) {
    case 'notJson':
      return 'This file is not a valid backup file: it is not valid JSON.'
    case 'notBackup':
    case 'invalid':
      return `This file is not a valid backup file: ${error.problem}.`
    case 'unsupportedVersion':
      return (
        `This backup format version (${error.version}) is not supported by ` +
        'this version of the app.'
      )
  }
}

/** Message shown when the selected file is too large or cannot be read (Req 12.9). */
export const FILE_UNREADABLE_MESSAGE = 'This file could not be read.'

/** Warning shown in the import confirmation: importing replaces everything (Req 12.11). */
export const IMPORT_REPLACE_WARNING = 'All current data will be replaced.'

/** Notice recommending regular backups when persistent storage is unavailable (Req 10.14). */
export const STORAGE_NOT_PERSISTENT_MESSAGE =
  'Your browser may delete app data when storage is low. Export a backup regularly.'

/** Banner text announcing a new App_Version is ready to apply (Req 10.9). */
export const UPDATE_AVAILABLE_MESSAGE = 'A new version is available.'

/** Standard button labels reused across dialogs and prompts. */
export const BUTTON_LABELS = {
  confirm: 'Confirm',
  cancel: 'Cancel',
  deleteAndStartFresh: 'Delete and start fresh',
  importBackup: 'Import backup',
  discardUnreadable: 'Discard unreadable data and start fresh',
  updateNow: 'Update now',
  later: 'Later',
} as const
