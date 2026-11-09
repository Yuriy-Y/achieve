/**
 * `ImportConfirmDialog` — the confirmation modal shown before replacing the
 * whole Data_Set with a parsed Backup_File (design: Browser integration —
 * import, UI components — `BackupPanel / ImportConfirmDialog`, Req 12.11-12.16,
 * 12.19, 12.20).
 *
 * Like `DiscardConfirmDialog`, this wraps the shared `ConfirmDialog` primitive,
 * so the native `<dialog>` modal semantics (focus trap, inert background,
 * Escape-to-cancel, backdrop click) come for free. The dialog shows the
 * replace-all warning, the export timestamp formatted in local time, and the
 * number of Activities in the Backup_File (`BackupMeta`, Req 12.11). Because an
 * import is a destructive replace, initial focus is placed on Cancel so confirm
 * is never the default target.
 *
 * Nothing is mutated until the user confirms: the parent (`BackupPanel`) only
 * opens this dialog after a successful `parseBackup`, and Cancel, Escape and a
 * backdrop click all route to `onCancel`, which closes the dialog and changes
 * nothing (Req 12.12).
 *
 * Confirm dispatches `importDataset(dataset)` through `useTrackerActions`
 * exactly once. The store replaces the whole Data_Set in one atomic write and,
 * on success, leaves recovery mode when it was active (Req 12.13, 12.19,
 * 12.20); the parent then closes the dialog. If the commit fails the store
 * rolls back to the previous Data_Set and reports `notSaved`; the dialog shows
 * the commit-failed message inline and stays open so the user can retry or
 * cancel (Req 12.16). The shared `Notifications` region also announces the
 * failure because the store records the notice.
 *
 * No inline styles are used (CSP `style-src 'self'`); all sizing and the 44px
 * touch targets come from the task-14 stylesheet via `className`.
 */

import { useState } from 'react'
import type { ReactElement } from 'react'

import type { BackupMeta } from '../domain/backup'
import type { Dataset } from '../domain/dataset'
import type { CommandResult } from '../state/TrackerStore'
import { ConfirmDialog } from './ConfirmDialog'
import { BUTTON_LABELS, COMMIT_FAILED_MESSAGE, IMPORT_REPLACE_WARNING } from './messages'

/** Props for {@link ImportConfirmDialog}. */
export interface ImportConfirmDialogProps {
  /** Whether the dialog is shown. The parent (`BackupPanel`) owns this. */
  open: boolean
  /** Summary of the parsed Backup_File shown to the user (Req 12.11). */
  meta: BackupMeta
  /** The validated Dataset to import when the user confirms. */
  dataset: Dataset
  /** Import action from `useTrackerActions`; called only on confirm. */
  onImport: (dataset: Dataset) => Promise<CommandResult>
  /**
   * Called when the import succeeds so the parent can close the dialog. The
   * store replaces the Data_Set and leaves recovery mode itself; this is purely
   * for closing the modal.
   */
  onImported: () => void
  /** Called when the user cancels, presses Escape, or clicks the backdrop. */
  onCancel: () => void
}

/**
 * Format the Backup_File export timestamp in local time for the confirmation
 * (design: "Exported 10 Feb 2026, 09:15"). `exportedAt` is an ISO 8601 UTC
 * string; an unparseable value (already filtered by `parseBackup`) falls back
 * to the raw string so the dialog never throws.
 */
function formatExportedAt(exportedAt: string): string {
  const parsed = new Date(exportedAt)
  if (Number.isNaN(parsed.getTime())) return exportedAt
  const formatter = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return formatter.format(parsed)
}

/**
 * The import confirmation dialog. Holds only the inline error text and the
 * in-flight flag locally; all Data_Set state lives in the store.
 */
export function ImportConfirmDialog({
  open,
  meta,
  dataset,
  onImport,
  onImported,
  onCancel,
}: ImportConfirmDialogProps): ReactElement {
  const [errorText, setErrorText] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)

  const handleConfirm = async (): Promise<void> => {
    if (importing) return
    setImporting(true)
    const result = await onImport(dataset)
    setImporting(false)

    if (result.status === 'saved') {
      // The store has replaced the Data_Set (and left recovery mode if it was
      // active) (Req 12.13, 12.20). Close the dialog.
      setErrorText(null)
      onImported()
      return
    }

    // notSaved: the commit failed and the store rolled back to the previous
    // Data_Set (Req 12.16). Stay open and show the message inline; the shared
    // Notifications region also announces it. (`rejected` cannot occur: the
    // dataset was already validated by `parseBackup`.)
    setErrorText(COMMIT_FAILED_MESSAGE)
  }

  const handleCancel = (): void => {
    // A cancelled confirmation changes nothing (Req 12.12). Clear any stale
    // error so a later open starts clean.
    setErrorText(null)
    onCancel()
  }

  const activityLabel = meta.activityCount === 1 ? 'activity' : 'activities'

  return (
    <ConfirmDialog
      open={open}
      title="Import backup"
      confirmLabel={BUTTON_LABELS.importBackup}
      cancelLabel={BUTTON_LABELS.cancel}
      destructive
      initialFocus="cancel"
      onConfirm={handleConfirm}
      onCancel={handleCancel}
    >
      <p className="import-confirm-warning">{IMPORT_REPLACE_WARNING}</p>
      <dl className="import-confirm-summary">
        <div className="import-confirm-summary-row">
          <dt>Exported</dt>
          <dd>{formatExportedAt(meta.exportedAt)}</dd>
        </div>
        <div className="import-confirm-summary-row">
          <dt>Activities</dt>
          <dd>
            {meta.activityCount} {activityLabel}
          </dd>
        </div>
      </dl>
      {errorText !== null ? (
        <p className="import-confirm-error" role="alert">
          {errorText}
        </p>
      ) : null}
    </ConfirmDialog>
  )
}
