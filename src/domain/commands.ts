/**
 * Command layer for the Achievement Tracker domain (pure functions, no I/O).
 *
 * A `Command` carries the raw user input for one action; `applyCommand` parses
 * and validates it against the current `Dataset` and a `CommandContext`
 * (today's LocalDate, the current timestamp, and an id factory). On success it
 * returns the new immutable `Dataset` (built with structural sharing via the
 * `dataset.ts` / `goals.ts` helpers) together with the `Mutation` the storage
 * layer must persist. On failure it returns a `CommandError` and no new state,
 * so a rejected command never changes the published Dataset (design: Commands,
 * Property 4; Requirements 1.5, 3.4, 3.5, 4.5, 4.6, 6.7, 6.8).
 *
 * Validation is delegated to the existing domain modules: Activity names via
 * `names.ts`, Daily_Value and Goal values via `decimal.ts`, dates and Periods
 * via `calendar.ts`, and Goal_Version history via `goals.ts`.
 *
 * Isolation (Property 8, Req 2.6, 4.3): every non-import command touches only
 * the records of its target Activity, and `recordValue` never changes any
 * Goal_Version.
 *
 * The `Mutation` type mirrors the design's `StoragePort` definition. The
 * storage layer is built later and will own the canonical declaration; it is
 * declared locally here (structurally identical) so this module type-checks on
 * its own, the same approach `dataset.ts` takes for its primitive aliases.
 */
import type {
  Activity,
  DailyValue,
  Dataset,
  GoalVersion,
  Milli,
} from './dataset'
import { deleteActivityValues, setDailyValue } from './dataset'
import type { GoalType, LocalDate } from './calendar'
import { compareDates, isValidLocalDate } from './calendar'
import { parseDailyValue, parseGoalValue, type ParseError } from './decimal'
import { validateActivityName, type NameError } from './names'
import { removeGoal, setGoal } from './goals'

/**
 * A single user action, carrying raw input strings. `applyCommand` parses and
 * validates each field; `importDataset` carries a Dataset already validated by
 * `parseBackup` (design: Commands).
 */
export type Command =
  | { kind: 'createActivity'; name: string; weeklyGoal?: string; monthlyGoal?: string }
  | { kind: 'renameActivity'; activityId: string; name: string }
  | { kind: 'deleteActivity'; activityId: string }
  | { kind: 'recordValue'; activityId: string; date: LocalDate; value: string }
  | { kind: 'setGoal'; activityId: string; goalType: GoalType; value: string }
  | { kind: 'removeGoal'; activityId: string; goalType: GoalType }
  | { kind: 'importDataset'; dataset: Dataset }

/**
 * Ambient values `applyCommand` needs that are not part of a command:
 * today's LocalDate, the current timestamp for `createdAt`, and an id factory
 * (normally `crypto.randomUUID`, injected to keep `applyCommand` pure).
 */
export interface CommandContext {
  today: LocalDate
  now: string
  newId: () => string
}

/**
 * Why a command was rejected, tagged with the input field it concerns so the
 * UI can link the message with `aria-describedby` (design: Error Handling).
 */
export type CommandError =
  | { field: 'name'; code: NameError }
  | { field: 'value'; code: ParseError }
  | { field: 'date'; code: 'future' }
  | { field: 'weeklyGoal' | 'monthlyGoal' | 'goal'; code: ParseError }
  | { field: 'activity'; code: 'notFound' }

/**
 * The storage mutation a committed command must persist. `patch` applies puts
 * and cascading deletes; `replaceAll` replaces the whole Data_Set (import).
 * Mirrors the design's `StoragePort.Mutation`; the storage layer owns the
 * canonical declaration once it exists.
 */
export type Mutation =
  | {
      kind: 'patch'
      putActivities: Activity[]
      deleteActivityIds: string[]
      putDailyValues: DailyValue[]
      putGoalVersions: GoalVersion[]
    }
  | { kind: 'replaceAll'; dataset: Dataset }

/**
 * The result of `applyCommand`: either the new Dataset plus the Mutation to
 * persist, or a `CommandError` with no state change (design: Commands).
 */
export type ApplyResult =
  | { ok: true; next: Dataset; mutation: Mutation }
  | { ok: false; error: CommandError }

/** An empty `patch` mutation that the command builders extend. */
function emptyPatch(): Extract<Mutation, { kind: 'patch' }> {
  return {
    kind: 'patch',
    putActivities: [],
    deleteActivityIds: [],
    putDailyValues: [],
    putGoalVersions: [],
  }
}

/** Find an Activity by id, or `undefined` when it does not exist. */
function findActivity(ds: Dataset, activityId: string): Activity | undefined {
  return ds.activities.find((activity) => activity.id === activityId)
}

/** The next `createdSeq`: one past the greatest existing value, or 0 when empty. */
function nextCreatedSeq(ds: Dataset): number {
  let max = -1
  for (const activity of ds.activities) {
    if (activity.createdSeq > max) max = activity.createdSeq
  }
  return max + 1
}

/** Map a field name to the Goal parse error it carries. */
function goalError(
  field: 'weeklyGoal' | 'monthlyGoal' | 'goal',
  code: ParseError,
): CommandError {
  return { field, code }
}

/** Build a successful `ApplyResult` from a new Dataset and its Mutation. */
function accepted(next: Dataset, mutation: Mutation): ApplyResult {
  return { ok: true, next, mutation }
}

/** Build a rejected `ApplyResult` with no state change. */
function rejected(error: CommandError): ApplyResult {
  return { ok: false, error }
}

/**
 * Apply a `Command` to a `Dataset`.
 *
 * On success returns the new Dataset and the Mutation to persist; on failure
 * returns the first `CommandError` found and leaves the Dataset untouched.
 */
export function applyCommand(state: Dataset, cmd: Command, ctx: CommandContext): ApplyResult {
  switch (cmd.kind) {
    case 'createActivity':
      return applyCreateActivity(state, cmd, ctx)
    case 'renameActivity':
      return applyRenameActivity(state, cmd)
    case 'deleteActivity':
      return applyDeleteActivity(state, cmd)
    case 'recordValue':
      return applyRecordValue(state, cmd, ctx)
    case 'setGoal':
      return applySetGoal(state, cmd, ctx)
    case 'removeGoal':
      return applyRemoveGoal(state, cmd, ctx)
    case 'importDataset':
      return applyImportDataset(cmd)
  }
}

/**
 * Create an Activity (Req 1.1, 6.3, 6.4). The name and every provided Goal are
 * validated before anything is created, so a valid name with an invalid goal
 * creates neither the Activity nor any Goal_Version (Req 6.8, Property 4). Empty
 * goal fields count as not provided (Req 6.3). With a goal, one `set`
 * Goal_Version is written per provided type at that type's Current_Period
 * (Req 6.4). `createdSeq` is `max(existing) + 1` so ordering survives imports.
 */
function applyCreateActivity(
  state: Dataset,
  cmd: Extract<Command, { kind: 'createActivity' }>,
  ctx: CommandContext,
): ApplyResult {
  const nameResult = validateActivityName(cmd.name, state.activities)
  if (!nameResult.ok) return rejected({ field: 'name', code: nameResult.error })

  // Empty / whitespace-only goal fields count as not provided (Req 6.3).
  const weeklyRaw = normaliseGoalInput(cmd.weeklyGoal)
  const monthlyRaw = normaliseGoalInput(cmd.monthlyGoal)

  let weeklyValue: Milli | null = null
  if (weeklyRaw !== null) {
    const parsed = parseGoalValue(weeklyRaw)
    if (!parsed.ok) return rejected(goalError('weeklyGoal', parsed.error))
    weeklyValue = parsed.value
  }

  let monthlyValue: Milli | null = null
  if (monthlyRaw !== null) {
    const parsed = parseGoalValue(monthlyRaw)
    if (!parsed.ok) return rejected(goalError('monthlyGoal', parsed.error))
    monthlyValue = parsed.value
  }

  const activity: Activity = {
    id: ctx.newId(),
    name: nameResult.value,
    createdAt: ctx.now,
    createdSeq: nextCreatedSeq(state),
  }

  // Build the Goal_Versions for the provided goals, each at its Current_Period.
  let goalVersions = state.goalVersions
  const putGoalVersions: GoalVersion[] = []
  if (weeklyValue !== null) {
    const result = setGoal(goalVersions, activity.id, 'weekly', weeklyValue, ctx.today)
    goalVersions = result.versions
    putGoalVersions.push(result.put)
  }
  if (monthlyValue !== null) {
    const result = setGoal(goalVersions, activity.id, 'monthly', monthlyValue, ctx.today)
    goalVersions = result.versions
    putGoalVersions.push(result.put)
  }

  const next: Dataset = {
    activities: [...state.activities, activity],
    values: state.values,
    goalVersions,
  }
  const mutation = emptyPatch()
  mutation.putActivities = [activity]
  mutation.putGoalVersions = putGoalVersions
  return accepted(next, mutation)
}

/**
 * Rename an Activity (Req 1.6). Changes only that Activity's name to the
 * trimmed value and leaves its id, creation data, Daily_Values and
 * Goal_Versions untouched (Property 6). The renamed Activity is excluded from
 * the duplicate check so renaming to the same name is allowed (Req 1.4).
 */
function applyRenameActivity(
  state: Dataset,
  cmd: Extract<Command, { kind: 'renameActivity' }>,
): ApplyResult {
  const activity = findActivity(state, cmd.activityId)
  if (activity === undefined) return rejected({ field: 'activity', code: 'notFound' })

  const nameResult = validateActivityName(cmd.name, state.activities, cmd.activityId)
  if (!nameResult.ok) return rejected({ field: 'name', code: nameResult.error })

  const renamed: Activity = { ...activity, name: nameResult.value }
  const next: Dataset = {
    activities: state.activities.map((a) => (a.id === cmd.activityId ? renamed : a)),
    values: state.values,
    goalVersions: state.goalVersions,
  }
  const mutation = emptyPatch()
  mutation.putActivities = [renamed]
  return accepted(next, mutation)
}

/**
 * Delete an Activity and cascade (Req 1.9, 2.6). Removes the Activity, all its
 * Daily_Values and all its Goal_Versions in one mutation, and leaves every
 * other Activity's records identical (Property 7).
 */
function applyDeleteActivity(
  state: Dataset,
  cmd: Extract<Command, { kind: 'deleteActivity' }>,
): ApplyResult {
  const activity = findActivity(state, cmd.activityId)
  if (activity === undefined) return rejected({ field: 'activity', code: 'notFound' })

  const next: Dataset = {
    activities: state.activities.filter((a) => a.id !== cmd.activityId),
    values: deleteActivityValues(state.values, cmd.activityId),
    goalVersions: state.goalVersions.filter((v) => v.activityId !== cmd.activityId),
  }
  const mutation = emptyPatch()
  mutation.deleteActivityIds = [cmd.activityId]
  return accepted(next, mutation)
}

/**
 * Record or clear a Daily_Value (Req 3.2, 3.3, 3.5, 4.1, 4.4, 4.6, 12.23).
 *
 * The future-date gate is checked before parsing the value: a Day later than
 * today is rejected with `date: 'future'` (Req 3.5, 4.6, Property 10). A valid
 * value upserts exactly one entry per (activityId, date) (Req 3.3); the value
 * may be zero (Req 4.4). No Goal_Version is touched (Req 4.3, Property 8).
 */
function applyRecordValue(
  state: Dataset,
  cmd: Extract<Command, { kind: 'recordValue' }>,
  ctx: CommandContext,
): ApplyResult {
  const activity = findActivity(state, cmd.activityId)
  if (activity === undefined) return rejected({ field: 'activity', code: 'notFound' })

  // Future-date gate, before parsing the value (Req 3.5, 4.6).
  if (!isValidLocalDate(cmd.date) || compareDates(cmd.date, ctx.today) > 0) {
    return rejected({ field: 'date', code: 'future' })
  }

  const parsed = parseDailyValue(cmd.value)
  if (!parsed.ok) return rejected({ field: 'value', code: parsed.error })

  const dailyValue: DailyValue = {
    activityId: cmd.activityId,
    date: cmd.date,
    value: parsed.value,
  }
  const next: Dataset = {
    activities: state.activities,
    values: setDailyValue(state.values, cmd.activityId, cmd.date, parsed.value),
    goalVersions: state.goalVersions,
  }
  const mutation = emptyPatch()
  mutation.putDailyValues = [dailyValue]
  return accepted(next, mutation)
}

/**
 * Set or change a Goal (Req 6.5, 6.6, 8.1, 8.2, 8.3). Validates the value, then
 * upserts a `set` Goal_Version at the Current_Period of the Goal type via
 * `goals.ts`, leaving every other version unchanged (Property 20).
 */
function applySetGoal(
  state: Dataset,
  cmd: Extract<Command, { kind: 'setGoal' }>,
  ctx: CommandContext,
): ApplyResult {
  const activity = findActivity(state, cmd.activityId)
  if (activity === undefined) return rejected({ field: 'activity', code: 'notFound' })

  const parsed = parseGoalValue(cmd.value)
  if (!parsed.ok) return rejected(goalError('goal', parsed.error))

  const result = setGoal(state.goalVersions, cmd.activityId, cmd.goalType, parsed.value, ctx.today)
  const next: Dataset = {
    activities: state.activities,
    values: state.values,
    goalVersions: result.versions,
  }
  const mutation = emptyPatch()
  mutation.putGoalVersions = [result.put]
  return accepted(next, mutation)
}

/**
 * Remove a Goal (Req 8.4, 8.5, 8.3). When an Effective_Goal of the type exists
 * for the Current_Period, upserts a `removal` Goal_Version there; when none
 * exists, nothing changes and the mutation is an empty `patch` (Req 8.5,
 * Property 20).
 */
function applyRemoveGoal(
  state: Dataset,
  cmd: Extract<Command, { kind: 'removeGoal' }>,
  ctx: CommandContext,
): ApplyResult {
  const activity = findActivity(state, cmd.activityId)
  if (activity === undefined) return rejected({ field: 'activity', code: 'notFound' })

  const result = removeGoal(state.goalVersions, cmd.activityId, cmd.goalType, ctx.today)
  const next: Dataset = {
    activities: state.activities,
    values: state.values,
    goalVersions: result.versions,
  }
  const mutation = emptyPatch()
  if (result.put !== null) {
    mutation.putGoalVersions = [result.put]
  }
  return accepted(next, mutation)
}

/**
 * Import a Dataset (Req 12.13). The Dataset was already validated by
 * `parseBackup`, so the result is simply the imported Dataset plus a
 * `replaceAll` mutation.
 */
function applyImportDataset(cmd: Extract<Command, { kind: 'importDataset' }>): ApplyResult {
  return accepted(cmd.dataset, { kind: 'replaceAll', dataset: cmd.dataset })
}

/**
 * Normalise an optional Goal input field: `undefined` or whitespace-only means
 * "not provided" (`null`); otherwise the original (untrimmed) string, which
 * `parseGoalValue` trims and validates (Req 6.3).
 */
function normaliseGoalInput(raw: string | undefined): string | null {
  if (raw === undefined) return null
  return raw.trim() === '' ? null : raw
}
