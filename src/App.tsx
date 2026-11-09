/**
 * `App` — the composition root for the Achievement Tracker (design:
 * Architecture, "UI layer" and the Components table; Req 2.7, 9.2, 9.4, 9.5,
 * 9.8, 11.8).
 *
 * `App` is the one place that assembles the whole application from the pieces
 * built in the earlier tasks. It owns no domain logic: it constructs the
 * `TrackerStore`, wires the clock and locale, drives startup, chooses which
 * screen to show, and renders the shared live region. Everything it renders is
 * a component that already carries its own behaviour.
 *
 * What it wires (design: Startup flow, Clock and date changes):
 * - Constructs a single `TrackerStore` with `new IndexedDbStorage()`, the real
 *   clock `() => new Date()` and `newId = () => crypto.randomUUID()`, memoised
 *   so React never recreates it, and wraps the tree in `TrackerProvider`.
 * - Calls `store.init()` exactly once in an effect to load the persisted
 *   Data_Set; the UI shows a loading state until it resolves (Req 9.2).
 * - Drives `today` with `useToday(store.setToday)`, so today's value, the
 *   Current_Period, Goal_Status and which Days are editable all follow the real
 *   date (Req 2.8, 12.23). Components read the locale formatter themselves via
 *   `useNumberDisplay`, so `App` does not thread it through props.
 * - Requests persistent storage once after the first render and shows the
 *   one-time backup notice through `Notifications` when storage is not
 *   persistent (Req 10.13, 10.14, per `persistStorage`).
 *
 * What it renders (design: Components — `App`):
 * - While `snapshot.load.phase === 'loading'`: a minimal loading state.
 * - In `recovery` mode: the `RecoveryBanner` (Req 9.4, 9.8). The banner renders
 *   the self-contained `BackupPanel` for the import entry, so a confirmed
 *   import replaces the Data_Set and leaves recovery mode (Req 12.19, 12.20).
 * - In `normal` mode: the main screens with simple state-based navigation (no
 *   router, per design) between the Activity list and a per-Activity detail
 *   view (chart / goals / rename), plus create, and delete through the shared
 *   `ConfirmDialog`. The Activity list screen also carries a Backup section
 *   (`BackupPanel`) so export and import are always reachable (Req 12.1-12.6).
 * - Always: the shared `Notifications` polite live region, fed by the store's
 *   `notice` mapped to copy through `messages.ts`, plus the backup notice.
 *
 * Service-worker updates: `useAppUpdate` drives the prompt-mode flow and feeds
 * the non-modal `UpdatePrompt` banner, which is rendered only while a new
 * App_Version is waiting (`needRefresh`). "Update now" applies and reloads;
 * "Later" postpones so the update is applied on the next launch (Req
 * 10.9-10.11).
 *
 * Accessibility and CSP: the shell uses `header`/`main` landmarks, every
 * control is a real button, and no inline styles are used (all sizing and
 * theme come from CSS classes; styles land in task 14).
 */

import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'

import type { Activity } from './domain/dataset'
import { IndexedDbStorage } from './storage/IndexedDbStorage'
import { TrackerStore } from './state/TrackerStore'
import type { Notice } from './state/TrackerStore'
import {
  TrackerProvider,
  useTrackerActions,
  useTrackerSnapshot,
} from './state/useTracker'
import { useToday } from './state/useToday'
import {
  BACKUP_NOTICE_SHOWN_KEY,
  requestPersistence,
  shouldShowBackupNotice,
} from './state/persistStorage'
import { useAppUpdate } from './pwa/useAppUpdate'

import { ActivityList } from './ui/ActivityList'
import { ActivityForm } from './ui/ActivityForm'
import { BackupPanel } from './ui/BackupPanel'
import { ChartView } from './ui/ChartView'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { GoalPanel } from './ui/GoalPanel'
import { Notifications } from './ui/Notifications'
import { RecoveryBanner } from './ui/RecoveryBanner'
import { RenameForm } from './ui/RenameForm'
import { UpdatePrompt } from './ui/UpdatePrompt'
import {
  COMMIT_FAILED_MESSAGE,
  RECOVERY_WRITE_MESSAGE,
  STORAGE_NOT_PERSISTENT_MESSAGE,
  BUTTON_LABELS,
  discardErrorMessage,
} from './ui/messages'
import { useNumberDisplay } from './state/useNumberDisplay'

/**
 * The navigation state (design: "state-based navigation between list and
 * activity detail", no router). `list` is the Activity list; a detail `view`
 * names the open per-Activity screen and the Activity it targets. Create and
 * delete are overlays on top of whichever view is active, tracked separately so
 * they compose with both the list and a detail view.
 */
type DetailView =
  | { kind: 'list' }
  | { kind: 'chart'; activityId: string }
  | { kind: 'goals'; activityId: string }
  | { kind: 'rename'; activityId: string }

/**
 * Compose and provide the store, then render the application body. The store is
 * created once (memoised) with the real IndexedDB, clock and id factory and
 * never recreated across renders.
 */
export function App(): ReactElement {
  const store = useMemo(
    () => new TrackerStore(new IndexedDbStorage(), () => new Date(), () => crypto.randomUUID()),
    [],
  )

  // Load the persisted Data_Set once at startup (Req 9.2). `init` runs on the
  // store's own operation queue, so a second call (React 19 StrictMode double
  // invoke in development) simply enqueues behind the first and is harmless.
  useEffect(() => {
    void store.init()
  }, [store])

  // Drive `today` from the local clock; the hook updates the store when the day
  // rolls over (Req 2.8). `setToday` is a stable method on the memoised store.
  useToday(store.setToday)

  return (
    <TrackerProvider store={store}>
      <AppBody />
    </TrackerProvider>
  )
}

/**
 * The application body, rendered inside the provider so it can read the store
 * through the hooks. Owns the navigation state, the create/delete overlays, the
 * backup-notice flag and the import seam.
 */
function AppBody(): ReactElement {
  const snapshot = useTrackerSnapshot()

  // Navigation and overlay state (design: no router, state-based navigation).
  const [view, setView] = useState<DetailView>({ kind: 'list' })
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // One-time backup notice (Req 10.14). Shown through Notifications when
  // persistent storage is denied or unsupported and the notice is new.
  const [backupNotice, setBackupNotice] = useState(false)

  // Service-worker update flow (seam for task 13.2's UpdatePrompt).
  const update = useAppUpdate()

  // Request persistent storage once after the first render (Req 10.13). On a
  // denied/unsupported outcome that has not been shown before, surface the
  // one-time backup notice and record that it has been shown (Req 10.14).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (typeof navigator === 'undefined') return
      const outcome = await requestPersistence(navigator)
      if (cancelled) return
      const alreadyShown = readBackupNoticeShown()
      if (shouldShowBackupNotice(outcome, alreadyShown)) {
        setBackupNotice(true)
        writeBackupNoticeShown()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const load = snapshot.load

  // The notice copy for the shared live region: the store's transient notice
  // takes precedence (commit/discard/recovery), otherwise the one-time backup
  // notice (Req 1.10, 3.8, 8.13, 9.7, 9.13, 10.14, 12.16).
  const noticeMessage =
    noticeToMessage(snapshot.notice) ?? (backupNotice ? STORAGE_NOT_PERSISTENT_MESSAGE : null)

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">Achievement Tracker</h1>
      </header>

      <main className="app-main" aria-live="off">
        {load.phase === 'loading' ? (
          <LoadingState />
        ) : load.mode === 'recovery' ? (
          <RecoveryBanner />
        ) : (
          <MainScreens
            view={view}
            setView={setView}
            creating={creating}
            setCreating={setCreating}
            deletingId={deletingId}
            setDeletingId={setDeletingId}
          />
        )}
      </main>

      {update.needRefresh ? (
        <UpdatePrompt onApply={update.apply} onPostpone={update.postpone} />
      ) : null}

      <Notifications message={noticeMessage} />
    </div>
  )
}

/** The loading state shown until `store.init()` resolves (Req 9.2). */
function LoadingState(): ReactElement {
  return (
    <section className="app-loading" aria-busy="true" aria-label="Loading your activities">
      <p className="app-loading-message">Loading your activities…</p>
    </section>
  )
}

/** Props for {@link MainScreens}. */
interface MainScreensProps {
  view: DetailView
  setView: (view: DetailView) => void
  creating: boolean
  setCreating: (creating: boolean) => void
  deletingId: string | null
  setDeletingId: (id: string | null) => void
}

/**
 * The normal-mode screens: the Activity list, the per-Activity detail views
 * (chart / goals / rename), the create form overlay, and the delete
 * confirmation. Navigation is plain component state (design: no router).
 */
function MainScreens({
  view,
  setView,
  creating,
  setCreating,
  deletingId,
  setDeletingId,
}: MainScreensProps): ReactElement {
  const snapshot = useTrackerSnapshot()
  const { deleteActivity, setGoal, removeGoal } = useTrackerActions()
  const fmt = useNumberDisplay()

  const dataset = snapshot.load.phase === 'ready' ? snapshot.load.dataset : null
  const activities = dataset?.activities ?? []

  const backToList = (): void => setView({ kind: 'list' })

  // Resolve the Activity targeted by a detail view; if it no longer exists
  // (e.g. deleted in another tab), fall back to the list so no stale view
  // lingers (design Error Handling: "close the stale view, return to list").
  const detailActivity =
    view.kind === 'list' ? null : findActivity(activities, view.activityId)

  if (view.kind !== 'list' && detailActivity === null) {
    // The target vanished; drop back to the list on the next render.
    return <ListScreen onCreate={() => setCreating(true)} onNavigate={setView} onDelete={setDeletingId} creating={creating} setCreating={setCreating} deletingId={deletingId} setDeletingId={setDeletingId} />
  }

  return (
    <>
      {view.kind === 'list' ? (
        <ListScreen
          onCreate={() => setCreating(true)}
          onNavigate={setView}
          onDelete={setDeletingId}
          creating={creating}
          setCreating={setCreating}
          deletingId={deletingId}
          setDeletingId={setDeletingId}
        />
      ) : null}

      {view.kind === 'chart' && detailActivity !== null ? (
        <ChartView
          activityId={detailActivity.id}
          activityName={detailActivity.name}
          onClose={backToList}
        />
      ) : null}

      {view.kind === 'goals' && detailActivity !== null && dataset !== null ? (
        <section className="activity-detail" aria-label={`Goals for ${detailActivity.name}`}>
          <DetailHeader title={detailActivity.name} onClose={backToList} />
          <GoalPanel
            dataset={dataset}
            activityId={detailActivity.id}
            activityName={detailActivity.name}
            today={snapshot.today}
            fmt={fmt}
            onSetGoal={setGoal}
            onRemoveGoal={removeGoal}
          />
        </section>
      ) : null}

      {view.kind === 'rename' && detailActivity !== null ? (
        <section className="activity-detail" aria-label={`Rename ${detailActivity.name}`}>
          <DetailHeader title="Rename activity" onClose={backToList} />
          <RenameForm
            activityId={detailActivity.id}
            currentName={detailActivity.name}
            onRenamed={backToList}
            onCancel={backToList}
          />
        </section>
      ) : null}

      {/* Delete confirmation overlay, composable with any view (Req 1.7-1.9). */}
      <DeleteConfirm
        activity={deletingId === null ? null : findActivity(activities, deletingId)}
        onConfirm={async () => {
          if (deletingId === null) return
          await deleteActivity(deletingId)
          // Whether or not the view targeted this Activity, return to the list
          // so no stale detail view remains, and close the dialog.
          setDeletingId(null)
          setView({ kind: 'list' })
        }}
        onCancel={() => setDeletingId(null)}
      />
    </>
  )
}

/** Props for {@link ListScreen}. */
interface ListScreenProps {
  onCreate: () => void
  onNavigate: (view: DetailView) => void
  onDelete: (id: string) => void
  creating: boolean
  setCreating: (creating: boolean) => void
  deletingId: string | null
  setDeletingId: (id: string | null) => void
}

/**
 * The Activity list screen plus the create-form overlay. The list delegates the
 * per-row actions back here, which map to navigation or the delete overlay.
 */
function ListScreen({
  onCreate,
  onNavigate,
  onDelete,
  creating,
  setCreating,
}: ListScreenProps): ReactElement {
  return (
    <>
      <ActivityList
        onCreateActivity={onCreate}
        onOpenChart={(activityId) => onNavigate({ kind: 'chart', activityId })}
        onOpenGoals={(activityId) => onNavigate({ kind: 'goals', activityId })}
        onRename={(activityId) => onNavigate({ kind: 'rename', activityId })}
        onDelete={onDelete}
      />

      {/* Backup section always reachable in normal mode: export and import of
          the Data_Set (Req 12.1-12.6). BackupPanel is self-contained. */}
      <BackupPanel />

      {creating ? (
        <section className="activity-detail" aria-label="Create activity">
          <DetailHeader title="Create activity" onClose={() => setCreating(false)} />
          <ActivityForm
            onCreated={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        </section>
      ) : null}
    </>
  )
}

/** Props for {@link DeleteConfirm}. */
interface DeleteConfirmProps {
  activity: Activity | null
  onConfirm: () => void
  onCancel: () => void
}

/**
 * The delete confirmation dialog, wired to the shared `ConfirmDialog`. Open
 * exactly when an Activity is targeted for deletion; the prompt names the
 * Activity and offers confirm/cancel (Req 1.7). Cancel, Escape and the backdrop
 * all keep the Activity (Req 1.8); confirm removes it and its data (Req 1.9).
 */
function DeleteConfirm({ activity, onConfirm, onCancel }: DeleteConfirmProps): ReactElement {
  return (
    <ConfirmDialog
      open={activity !== null}
      title="Delete activity"
      confirmLabel={BUTTON_LABELS.confirm}
      cancelLabel={BUTTON_LABELS.cancel}
      destructive
      initialFocus="cancel"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p className="delete-confirm-message">
        {activity === null
          ? ''
          : `Delete "${activity.name}" and all of its recorded values and goals? This cannot be undone.`}
      </p>
    </ConfirmDialog>
  )
}

/** Props for {@link DetailHeader}. */
interface DetailHeaderProps {
  title: string
  onClose: () => void
}

/** A small header for a detail/overlay view with a title and a Back control. */
function DetailHeader({ title, onClose }: DetailHeaderProps): ReactElement {
  return (
    <div className="activity-detail-header">
      <h2 className="activity-detail-title">{title}</h2>
      <button type="button" className="activity-detail-close" onClick={onClose}>
        Back
      </button>
    </div>
  )
}

/** Find an Activity by id, or `null` when it is no longer present. */
function findActivity(activities: readonly Activity[], id: string): Activity | null {
  return activities.find((activity) => activity.id === id) ?? null
}

/**
 * Map the store's transient `Notice` to its user-facing sentence from the
 * design's message table (via `messages.ts`), or `null` when there is nothing
 * to announce. `App` renders this into the shared polite live region.
 */
function noticeToMessage(notice: Notice | null): string | null {
  if (notice === null) return null
  switch (notice.kind) {
    case 'commitFailed':
      return COMMIT_FAILED_MESSAGE
    case 'recovery':
      return RECOVERY_WRITE_MESSAGE
    case 'discardFailed':
      return discardErrorMessage(notice.reason)
  }
}

/** Read the one-time backup-notice flag from `localStorage`, defaulting to not shown. */
function readBackupNoticeShown(): boolean {
  try {
    return localStorage.getItem(BACKUP_NOTICE_SHOWN_KEY) === '1'
  } catch {
    return false
  }
}

/** Record that the one-time backup notice has been shown. */
function writeBackupNoticeShown(): void {
  try {
    localStorage.setItem(BACKUP_NOTICE_SHOWN_KEY, '1')
  } catch {
    /* localStorage may be unavailable; the notice simply shows again next time. */
  }
}
