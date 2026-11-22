/**
 * Tags on Daily_Entries (Requirement 14). Pure functions, no I/O.
 *
 * A Tag is a short label (1-30 code points, no comma or line break). Identity
 * is case-insensitive (`tagKey`); identity of a Tag_Combination is the sorted
 * list of tag keys (`comboKey`). The Tag_Library is derived from the tagged
 * entries of a Dataset, so there is no registry to keep in sync.
 */
import { err, ok, type Result } from './result'
import { allTaggedValues, type Dataset, type TagRatio } from './dataset'
import { RATIO_ONE } from './decimal'

export const TAG_MAX_CHARS = 30
export const TAGS_PER_ENTRY_MAX = 3
export const SUGGESTIONS_MAX = 8

export type TagError = 'empty' | 'tooLong' | 'invalidChar' | 'tooMany' | 'duplicate'

/** Case-insensitive identity of a Tag. */
export const tagKey = (tag: string): string => tag.normalize('NFC').toLocaleLowerCase('en')

/** Order-independent identity of a Tag_Combination; '' for the untagged combination. */
export const comboKey = (tags: readonly string[]): string => tags.map(tagKey).sort().join('\u001f')

/** Trim; 1..30 code points; no comma, line break. */
export function validateTag(raw: string): Result<string, 'empty' | 'tooLong' | 'invalidChar'> {
  const trimmed = raw.trim()
  if (trimmed === '') return err('empty')
  if (/[,\n\r]/.test(trimmed)) return err('invalidChar')
  if (Array.from(trimmed).length > TAG_MAX_CHARS) return err('tooLong')
  return ok(trimmed)
}

export interface TagLibraryEntry {
  key: string
  label: string
  /** Number of Daily_Entries using the Tag. */
  count: number
}

/**
 * The Tag_Library: distinct Tags used by tagged entries, with usage counts and
 * the spelling of the first use encountered (entries sorted by date so the
 * choice is deterministic). Optionally ignores one entry (the one being
 * replaced) so its own spelling does not pin the library.
 */
export function tagLibrary(
  ds: Pick<Dataset, 'taggedValues'>,
  ignore?: { activityId: string; date: string; comboKey: string },
): TagLibraryEntry[] {
  const found = new Map<string, TagLibraryEntry>()
  const entries = allTaggedValues(ds.taggedValues).sort((a, b) =>
    a.entry.date < b.entry.date ? -1 : a.entry.date > b.entry.date ? 1 : 0,
  )
  for (const { entry, comboKey: key } of entries) {
    if (
      ignore !== undefined &&
      entry.activityId === ignore.activityId &&
      entry.date === ignore.date &&
      key === ignore.comboKey
    ) {
      continue
    }
    for (const tag of entry.tags) {
      const k = tagKey(tag)
      const existing = found.get(k)
      if (existing === undefined) found.set(k, { key: k, label: tag, count: 1 })
      else existing.count += 1
    }
  }
  return [...found.values()]
}

/**
 * Validates a full tag list for one Daily_Entry and adopts library spellings
 * (Req 14.2-14.6, 14.11, 14.12). Checks each entry in order: `validateTag`,
 * duplicate within the list, then the count limit.
 */
export function resolveTags(
  raws: readonly string[],
  library: readonly Pick<TagLibraryEntry, 'key' | 'label'>[],
  extraSpellings: readonly Pick<TagLibraryEntry, 'key' | 'label'>[] = [],
): Result<string[], { code: TagError; index: number }> {
  const spelling = new Map<string, string>()
  for (const e of extraSpellings) spelling.set(e.key, e.label)
  for (const e of library) spelling.set(e.key, e.label)
  const seen = new Set<string>()
  const out: string[] = []
  for (let index = 0; index < raws.length; index += 1) {
    const valid = validateTag(raws[index])
    if (!valid.ok) return err({ code: valid.error, index })
    const key = tagKey(valid.value)
    if (seen.has(key)) return err({ code: 'duplicate', index })
    seen.add(key)
    out.push(spelling.get(key) ?? valid.value)
  }
  if (raws.length > TAGS_PER_ENTRY_MAX) {
    return err({ code: 'tooMany', index: TAGS_PER_ENTRY_MAX })
  }
  return ok(out)
}

/**
 * Suggestions (Req 14.7-14.9): empty text -> most used unattached; else prefix
 * matches, falling back to "contains"; ordered by count desc then label; max 8.
 */
export function suggestTags(
  library: readonly TagLibraryEntry[],
  typed: string,
  attached: readonly string[],
): string[] {
  const attachedKeys = new Set(attached.map(tagKey))
  const candidates = library.filter((t) => !attachedKeys.has(t.key))
  const needle = tagKey(typed.trim())
  let matches = candidates
  if (needle !== '') {
    const prefix = candidates.filter((t) => t.key.startsWith(needle))
    matches = prefix.length > 0 ? prefix : candidates.filter((t) => t.key.includes(needle))
  }
  return [...matches]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'en'))
    .slice(0, SUGGESTIONS_MAX)
    .map((t) => t.label)
}

/**
 * Weighted_Value of one entry (Req 16.7): `value x r1 x ... x rk / 1000^k`
 * rounded once, half away from zero, to milli. Exact `bigint` arithmetic: the
 * result can exceed the safe integer range (1000^3 x 999,999.999). The empty
 * combination and unassigned tags (ratio 1) leave the value unchanged.
 */
export function weightedValue(
  entry: { value: number; tags: readonly string[] },
  ratios: ReadonlyMap<string, Pick<TagRatio, 'ratio'>>,
): bigint {
  let numerator = BigInt(entry.value)
  let denominator = 1n
  for (const tag of entry.tags) {
    numerator *= BigInt(ratios.get(tagKey(tag))?.ratio ?? RATIO_ONE)
    denominator *= BigInt(RATIO_ONE)
  }
  if (denominator === 1n) return numerator
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const rounded = (2n * magnitude + denominator) / (2n * denominator)
  return negative ? -rounded : rounded
}
