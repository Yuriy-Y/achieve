/**
 * One-time request for persistent storage at startup (Req 10.13) and the
 * decision whether to show the one-time backup notice (Req 10.14).
 *
 * The browser may evict the Tracker's IndexedDB data when storage is low
 * unless persistent storage has been granted. On startup the Tracker asks for
 * persistent storage once; when the request is denied or the browser does not
 * support it, a dismissible notice recommends regular Backup_File export.
 *
 * This module is framework-free: a single async function plus a pure helper.
 * It is resilient to browsers without the StorageManager API (feature-detect
 * and swallow errors), so it never throws into React render.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
 */

/** Outcome of requesting persistent storage for the Tracker's data. */
export type PersistOutcome = 'granted' | 'denied' | 'unsupported'

/** localStorage key recording that the backup notice has already been shown. */
export const BACKUP_NOTICE_SHOWN_KEY = 'achievement-tracker.backupNoticeShown'

/**
 * Request persistent storage for the Tracker's data (Req 10.13).
 *
 * - When `navigator.storage.persist` is missing, returns `'unsupported'`.
 * - When persistent storage has already been granted
 *   (`navigator.storage.persisted()` is `true`), returns `'granted'` without
 *   asking again.
 * - Otherwise asks for persistence with `navigator.storage.persist()` and
 *   returns `'granted'` or `'denied'` accordingly.
 *
 * Any thrown error (for example in a restricted context) is treated as
 * `'unsupported'`, so the caller can always rely on a resolved outcome.
 */
export async function requestPersistence(nav: Navigator): Promise<PersistOutcome> {
  const storage = nav.storage
  if (!storage || typeof storage.persist !== 'function') {
    return 'unsupported'
  }
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) {
      return 'granted'
    }
    const granted = await storage.persist()
    return granted ? 'granted' : 'denied'
  } catch {
    return 'unsupported'
  }
}

/**
 * Decide whether to show the one-time backup notice (Req 10.14).
 *
 * The notice is shown exactly once when persistent storage is `'denied'` or
 * `'unsupported'` and it has not been shown before. A `'granted'` outcome
 * never shows the notice.
 */
export function shouldShowBackupNotice(outcome: PersistOutcome, noticeShown: boolean): boolean {
  if (noticeShown) {
    return false
  }
  return outcome === 'denied' || outcome === 'unsupported'
}
