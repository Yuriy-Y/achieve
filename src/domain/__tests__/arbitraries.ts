import fc from 'fast-check'
import { addDays, currentPeriod, periodOf } from '../calendar'
import type { LocalDate } from '../calendar'
import { comboKey } from '../tags'
import {
  emptyDataset,
  setDailyValue,
  setTaggedValue,
  type Activity,
  type Dataset,
  type GoalVersion,
  type TagRatio,
} from '../dataset'
import { tagKey } from '../tags'
import { DAILY_MAX, GOAL_MAX } from '../decimal'

/** A fixed "today" so generated data can include past and future days. */
export const TODAY: LocalDate = '2026-03-18'

export const arbDay: fc.Arbitrary<LocalDate> = fc
  .integer({ min: -400, max: 20 })
  .map((offset) => addDays(TODAY, offset))

export const arbMilliDaily = (allowNegative: boolean): fc.Arbitrary<number> =>
  fc.oneof(
    fc.integer({ min: allowNegative ? -DAILY_MAX : 0, max: DAILY_MAX }),
    fc.integer({ min: allowNegative ? -5000 : 0, max: 5000 }),
    fc.constantFrom(0, 1, DAILY_MAX, ...(allowNegative ? [-1, -DAILY_MAX] : [])),
  )

const NAMES = ['Running km', 'Pages read', 'Push-ups', 'Water l', 'Sleep h', 'Steps k']
export const TAG_POOL = ['Gym', 'Morning', 'Hills', 'Rain', 'Work', 'Café']

export const arbTagList: fc.Arbitrary<string[]> = fc
  .uniqueArray(fc.constantFrom(...TAG_POOL), { minLength: 1, maxLength: 3 })

interface Options {
  allowNegative: boolean
  tagged: boolean
}

/** A valid Dataset (invariants I1-I5, I7). `tagged: false` produces legacy-shaped data. */
export const arbDataset = (opts: Options): fc.Arbitrary<Dataset> =>
  fc
    .record({
      names: fc.uniqueArray(fc.constantFrom(...NAMES), { minLength: 0, maxLength: 4 }),
      days: fc.array(fc.tuple(fc.nat(5), arbDay, arbMilliDaily(opts.allowNegative)), { maxLength: 40 }),
      tagged: fc.array(
        fc.tuple(fc.nat(5), arbDay, arbTagList, arbMilliDaily(opts.allowNegative)),
        { maxLength: opts.tagged ? 25 : 0 },
      ),
      ratios: fc.uniqueArray(
        fc.tuple(fc.constantFrom(...TAG_POOL), fc.integer({ min: 1, max: 1_000_000 })),
        { selector: ([t]) => t, maxLength: opts.tagged ? 4 : 0 },
      ),
      goals: fc.array(
        fc.tuple(
          fc.nat(5),
          fc.constantFrom<'weekly' | 'monthly'>('weekly', 'monthly'),
          arbDay,
          fc.boolean(),
          fc.integer({ min: 1, max: GOAL_MAX }),
        ),
        { maxLength: 8 },
      ),
    })
    .map(({ names, days, tagged, ratios, goals }) => {
      const activities: Activity[] = names.map((name, i) => ({
        id: `a${i}`,
        name,
        createdAt: `2026-01-0${i + 1}T07:00:00.000Z`,
        createdSeq: i + 1,
      }))
      let ds: Dataset = { ...emptyDataset(), activities }
      if (activities.length === 0) return ds
      const pick = (n: number): string => activities[n % activities.length].id
      let values = ds.values
      for (const [n, date, value] of days) values = setDailyValue(values, pick(n), date, value)
      let taggedValues = ds.taggedValues
      for (const [n, date, tags, value] of tagged) {
        taggedValues = setTaggedValue(
          taggedValues,
          { activityId: pick(n), date, tags, value },
          comboKey(tags),
        )
      }
      const tagRatios = new Map<string, TagRatio>(
        ratios
          .filter(([, r]) => r !== 1000)
          .map(([label, ratio]) => [tagKey(label), { key: tagKey(label), label, ratio }]),
      )
      const goalVersions = new Map<string, GoalVersion>()
      for (const [n, goalType, date, isSet, value] of goals) {
        const startPeriod = periodOf(date, goalType).key
        const activityId = pick(n)
        const key = `${activityId}|${goalType}|${startPeriod}`
        goalVersions.set(
          key,
          isSet
            ? { activityId, goalType, startPeriod, kind: 'set', value }
            : { activityId, goalType, startPeriod, kind: 'removal' },
        )
      }
      ds = { ...ds, values, taggedValues, tagRatios, goalVersions: [...goalVersions.values()] }
      return ds
    })

export const arbLegacyDataset = arbDataset({ allowNegative: false, tagged: false })
export const arbFullDataset = arbDataset({ allowNegative: true, tagged: true })

export { currentPeriod }
