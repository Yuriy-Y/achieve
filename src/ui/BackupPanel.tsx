/**
 * `BackupPanel` — export and import of the Backup_File (design: UI components —
 * `BackupPanel / ImportConfirmDialog`, Browser integration: export/import, Req
 * 12.1-12.16, 12.19, 12.20).
 *
 * EXPORT half (task 15.1). It reads the current Data_Set from the active
 * snapshot (`useTrackerSnapshot`) and offers two export actions, both built
 * from a single synchronous `serialiseBackup` call so the work stays inside the
 * user's gesture (Safari requires transient activation for `navigator.share`):
 *
 *   - "Share…" is shown only when the device can share files
 *     (`navigator.canShare({ files: [file] })`). It calls `navigator.share`
 *     with the Backup_File. A user-cancelled share (`AbortError`) is ignored;
 *     any other share failure shows a message and leaves "Download" available
 *     (Req 12.4, 12.5).
 *   - "Download" is always available. It creates an object URL for a
 *     `Blob` (`application/json`), clicks a programmatic `<a download>` with the
 *     `backupFileName(todayLocal(new Date()))` name, then revokes the URL
 *     (Req 12.3, 12.5).
 *
 * Export never mutates the store: `serialiseBackup` is a pure read of the
 * immutable `Dataset`, and identical data serialises to identical text apart
 * from the export timestamp, so repeated exports are idempotent (handled by the
 * domain, Req 12.2, 12.6, 12.18). Export works with an empty Data_Set — the
 * domain writes a valid Backup_File with empty arrays (Req 12.6) — so the
 * buttons are never disabled on account of the data being empty.
 *
 * IMPORT half (task 15.2). A labelled 44px "Import backup" button triggers a
 * hidden `<input type="file" accept=".json,application/json">`. On selection
 * the file is read with `file.text()` (files over 64 MB and read failures show
 * "This file could not be read.", Req 12.9) and passed to `parseBackup`. A
 * parse error shows the mapped message and changes nothing (Req 12.7-12.10). A
 * successful parse opens `ImportConfirmDialog` with the `BackupMeta` summary and
 * the replace-all warning (Req 12.11); confirming dispatches `importDataset`,
 * which replaces the whole Data_Set atomically and leaves recovery mode when it
 * was active (Req 12.13, 12.19, 12.20). The file input is reset after each
 * selection so the same file can be re-picked.
 *
 * Nothing is mutated before the user confirms: reading and parsing are
 * side-effect free, and only `ImportConfirmDialog`'s confirm calls the store
 * (Req 12.7, 12.12).
 *
 * All sizing (44px touch targets) comes from CSS classes (task-14 stylesheet);
 * no inline styles are used (CSP `style-src 'self'`). Buttons carry explicit
 * accessible labels.
 */

import { useRef, useState } from 'react'
import type { ChangeEvent, ReactElement } from 'react'

import { todayLocal } from '../domain/calendar'
import { backupFileName, parseBackup, serialiseBackup } from '../domain/backup'
import type { BackupMeta } from '../domain/backup'
import type { Dataset } from '../domain/dataset'
import { useTrackerActions, useTrackerSnapshot } from '../state/useTracker'
import { ImportConfirmDialog } from './ImportConfirmDialog'
import { BUTTON_LABELS, FILE_UNREADABLE_MESSAGE, backupErrorMessage } from './messages'

/** MIME type and extension of the Backup_File. */
const BACKUP_MIME = 'application/json'

/** Message shown when `navigator.share` fails for a reason other than cancel (Req 12.5). */
const SHARE_FAILED_MESSAGE = 'Sharing failed. Use Download instead.'

/**
 * Upper bound on the Backup_File size before reading (design: "files over 64 MB
 * are rejected before parsing"). The 50 × 3,660 target serialises to about
 * 15 MB, so 64 MB leaves generous headroom while guarding against accidentally
 * reading a huge unrelated file into memory.
 */
const MAX_IMPORT_BYTES = 64 * 1024 * 1024

/** A parsed, validated Backup_File ready for the confirmation dialog. */
interface PendingImport {
  meta: BackupMeta
  dataset: Dataset
}

/**
 * The backup panel. Reads the Data_Set from the snapshot and exposes export and
 * import. Returns `null` only while the Tracker is still loading; in recovery
 * mode the published Dataset is empty, which still exports a valid empty
 * Backup_File (Req 12.6) and still allows import (Req 12.19).
 */
export function BackupPanel(): ReactElement | null {
  const snapshot = useTrackerSnapshot()
  const [shareError, setShareError] = useState<string | null>(null)

  if (snapshot.load.phase !== 'ready') {
    // Nothing to export or import until the initial load has resolved.
    return null
  }

  const dataset = snapshot.load.dataset

  return (
    <section className="backup-panel" aria-label="Backup">
      <h2 className="backup-panel-title">Backup</h2>
      <ExportActions dataset={dataset} shareError={shareError} setShareError={setShareError} />
      <ImportActions />
    </section>
  )
}

/**
 * The import controls: a labelled button that opens the file picker, inline
 * parse/read error text, and the `ImportConfirmDialog` shown once a file parses.
 */
function ImportActions(): ReactElement {
  const { importDataset } = useTrackerActions()
  const inputRef = useRef<HTMLInputElement>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)

  // Open the native file picker from the visible button so the control stays a
  // 44px touch target without exposing the raw file input.
  const openPicker = (): void => {
    setImportError(null)
    inputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const input = event.currentTarget
    const file = input.files?.[0] ?? null
    // Reset the input immediately so selecting the same file again re-fires
    // `change` (browsers suppress it otherwise).
    input.value = ''
    if (file === null) return

    setImportError(null)

    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(FILE_UNREADABLE_MESSAGE)
      return
    }

    let text: string
    try {
      text = await file.text()
    } catch {
      // A failed read changes nothing (Req 12.9).
      setImportError(FILE_UNREADABLE_MESSAGE)
      return
    }

    const parsed = parseBackup(text)
    if (!parsed.ok) {
      // Invalid file: show the mapped message, change nothing (Req 12.7-12.10).
      setImportError(backupErrorMessage(parsed.error))
      return
    }

    // Valid file: open the confirmation. Still nothing is mutated (Req 12.11).
    setPending({ meta: parsed.value.meta, dataset: parsed.value.dataset })
  }

  const closeDialog = (): void => {
    setPending(null)
  }

  return (
    <div className="backup-import">
      <button
        type="button"
        className="backup-import-button"
        onClick={openPicker}
        aria-label="Import backup file"
      >
        {BUTTON_LABELS.importBackup}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="backup-import-input"
        accept=".json,application/json"
        onChange={handleFileChange}
        hidden
      />
      {importError !== null ? (
        <p className="backup-import-error" role="alert">
          {importError}
        </p>
      ) : null}
      {pending !== null ? (
        <ImportConfirmDialog
          open
          meta={pending.meta}
          dataset={pending.dataset}
          onImport={importDataset}
          onImported={closeDialog}
          onCancel={closeDialog}
        />
      ) : null}
    </div>
  )
}

/** Props for the export action group. */
interface ExportActionsProps {
  dataset: Dataset
  shareError: string | null
  setShareError: (message: string | null) => void
}

/**
 * The export buttons. Builds the Backup_File synchronously on each press (a
 * fresh user gesture) so `navigator.share` keeps its transient activation, and
 * offers "Share…" only when the device can share the file.
 */
function ExportActions({ dataset, shareError, setShareError }: ExportActionsProps): ReactElement {
  // Build the Backup_File for the current gesture: synchronous, pure read.
  const buildFile = (): File => {
    const text = serialiseBackup(dataset, new Date())
    const name = backupFileName(todayLocal(new Date()))
    return new File([text], name, { type: BACKUP_MIME })
  }

  // `navigator.canShare` with files is not in all lib.dom typings; probe it
  // defensively so the Share button only appears when file sharing works.
  const file = buildFile()
  const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })

  const handleShare = async (): Promise<void> => {
    setShareError(null)
    const shareFile = buildFile()
    try {
      await navigator.share({ files: [shareFile], title: shareFile.name })
    } catch (error) {
      // The user dismissing the share sheet throws AbortError; ignore it
      // (Req 12.4). Any other failure keeps Download available (Req 12.5).
      if (error instanceof DOMException && error.name === 'AbortError') return
      setShareError(SHARE_FAILED_MESSAGE)
    }
  }

  const handleDownload = (): void => {
    setShareError(null)
    const downloadFile = buildFile()
    const url = URL.createObjectURL(downloadFile)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = downloadFile.name
      anchor.rel = 'noopener'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
    } finally {
      // Revoke inside the same gesture once the click has been dispatched.
      URL.revokeObjectURL(url)
    }
  }

  return (
    <div className="backup-export">
      {canShareFiles ? (
        <button
          type="button"
          className="backup-share"
          onClick={handleShare}
          aria-label="Share backup file"
        >
          Share…
        </button>
      ) : null}
      <button
        type="button"
        className="backup-download"
        onClick={handleDownload}
        aria-label="Download backup file"
      >
        Export backup
      </button>
      {shareError !== null ? (
        <p className="backup-share-error" role="alert">
          {shareError}
        </p>
      ) : null}
    </div>
  )
}
