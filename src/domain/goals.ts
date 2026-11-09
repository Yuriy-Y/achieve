/**
 * Goal_Version history and Effective_Goal resolution for the Achievement
 * Tracker (pure functions, no I/O). Covers the design's "Domain: goals.ts"
 * section and Requirements 6.1, 6.2, 6.5, 6.6, 8.1-8.8 and 8.11.
 *
 * A Goal_Version records a Goal value (`kind: 'set'`) or a Goal removal
 * (`kind: 'removal'`) together with the first Period from which it applies
 * (`startPeriod`). There is at most one Goal_Version per
 * (activityId, goalType, startPeriod) (invariant I3).
 *
 * Effective_Goal resolution (Req 6.1, 8.6): for an Activity, Goal type and
 * Period, take the Goal_Version of that Activity and type with the greatest
 * `startPeriod` on or before the Period; its value when it is a `set`, or none
 * when it is a `removal` or when no such version exists.
 *
 * User Goal changes write only at the Current_Period of the Goal type, so:
 *   - earlier Periods keep their Effective_Goal (history preservation, Req 8.7),
 *   - the Current_Period and later Periods inherit the new value until a later
 *     change (forward application, Req 8.8).
 *
 * Period keys are zero-padded, so lexicographic (string) comparison matches
 * chronological order within a Goal type (see `calendar.ts`). That lets
 * resolution and upserts compare `startPeriod` keys directly.
 */
import type { GoalVersion } from './dataset'
import type { GoalType, LocalDate, Period, PeriodKey } from './calendar'
import { currentPeriod, periodStart, compareDates } from './calendar'
import type { Milli } from './decimal'

/**
 * The Effective_Goal of an Activity and Goal type for a Period (Req 6.1, 8.6).
 *
 * Among the Activity's Goal_Versions of the Period's type whose `startPeriod`
 * is on or before `period.key`, the one with the greatest `startPeriod` wins;
 * its value is returned when it is a `set`, otherwise (a `removal`, or no such
 * version) the result is `null`.
 *
 * `period.type` selects the Goal type, so a weekly Period resolves weekly
 * Goal_Versions and a monthly Period resolves monthly ones.
 */
export function resolveEffectiveGoal(
  versions: readonly GoalVersion[],
  activityId: string,
  period: Period,
): Milli | null {
  let best: GoalVersion | null = null
  for (const version of versions) {
    if (version.activityId !== activityId) continue
    if (version.goalType !== period.type) continue
    // Keys are zero-padded: lexicographic order equals chronological order.
    if (version.startPeriod > period.key) continue
    if (best === null || version.startPeriod > best.startPeriod) {
      best = version
    }
  }
  if (best === null || best.kind === 'removal') return null
  return best.value
}

/**
 * Replace any existing Goal_Version of this Activity and Goal type at
 * `startPeriod` with `put`, keeping every other version unchanged, and return
 * the new ordered list. Upsert is keyed on (activityId, goalType, startPeriod)
 * so at most one version exists per key (Req 8.3, invariant I3).
 */
function upsertVersion(
  versions: readonly GoalVersion[],
  put: GoalVersion,
): GoalVersion[] {
  const next = versions.filter(
    (version) =>
      !(
        version.activityId === put.activityId &&
        version.goalType === put.goalType &&
        version.startPeriod === put.startPeriod
      ),
  )
  next.push(put)
  return next
}

/**
 * Set or change a Goal (Req 6.5, 6.6, 8.1, 8.2, 8.3).
 *
 * Upserts a `set` Goal_Version at the Current_Period of the Goal type,
 * replacing an existing version at that start Period (a second change within
 * the same Current_Period, Req 8.3) and leaving all other versions untouched,
 * including every Goal_Version of the other Goal type and every version that
 * starts at an earlier Period (Req 8.1, 8.2).
 *
 * Returns the new version list and the written version `put`.
 */
export function setGoal(
  versions: readonly GoalVersion[],
  activityId: string,
  type: GoalType,
  value: Milli,
  today: LocalDate,
): { versions: GoalVersion[]; put: GoalVersion } {
  const startPeriod: PeriodKey = currentPeriod(today, type).key
  const put: GoalVersion = { activityId, goalType: type, startPeriod, kind: 'set', value }
  return { versions: upsertVersion(versions, put), put }
}

/**
 * Remove a Goal (Req 8.4, 8.5, 8.3).
 *
 * When an Effective_Goal of this type exists for the Current_Period, upserts a
 * `removal` Goal_Version at the Current_Period (replacing any version that
 * already starts there) and keeps all earlier versions unchanged. When no
 * Effective_Goal exists there is no change (Req 8.5), signalled by `put: null`.
 *
 * Returns the (possibly unchanged) version list and the written version, or
 * `null` when nothing changed.
 */
export function removeGoal(
  versions: readonly GoalVersion[],
  activityId: string,
  type: GoalType,
  today: LocalDate,
): { versions: GoalVersion[]; put: GoalVersion | null } {
  const current = currentPeriod(today, type)
  if (resolveEffectiveGoal(versions, activityId, current) === null) {
    // No Effective_Goal to remove: leave every Goal_Version unchanged (Req 8.5).
    return { versions: [...versions], put: null }
  }
  const put: GoalVersion = {
    activityId,
    goalType: type,
    startPeriod: current.key,
    kind: 'removal',
  }
  return { versions: upsertVersion(versions, put), put }
}

/**
 * The Goal history of one Activity, newest first (Req 8.11).
 *
 * Returns exactly that Activity's Goal_Versions (both types), ordered by the
 * start Period's first Day descending. On a tie (a Week and a Month that start
 * on the same Day) the weekly version comes before the monthly one.
 */
export function goalHistory(
  versions: readonly GoalVersion[],
  activityId: string,
): GoalVersion[] {
  const own = versions.filter((version) => version.activityId === activityId)
  return own.sort((a, b) => {
    const startComparison = compareDates(
      periodStart({ type: a.goalType, key: a.startPeriod }),
      periodStart({ type: b.goalType, key: b.startPeriod }),
    )
    // Newest first: later start Period comes first.
    if (startComparison !== 0) return -startComparison
    // Tie on start Day: weekly before monthly.
    return goalTypeRank(a.goalType) - goalTypeRank(b.goalType)
  })
}

/** Ordering rank used to break history ties: weekly (0) before monthly (1). */
function goalTypeRank(type: GoalType): number {
  return type === 'weekly' ? 0 : 1
}
