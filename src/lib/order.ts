import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing"

export interface Orderable {
  id: string
  order: string
  pinned: boolean
}

/** Fractional-index keys are ordered by plain code-unit comparison, never by locale. */
export function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** The ordering every manually sorted view uses: pinned first, then the shared global order. */
export function compareManual(a: Orderable, b: Orderable): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return compareKeys(a.order, b.order)
}

/** Keys that place `n` new items above everything else, preserving their given order. */
export function keysAtTop(existing: readonly { order: string }[], n: number): string[] {
  let min: string | null = null
  for (const item of existing) if (min === null || item.order < min) min = item.order
  return generateNKeysBetween(null, min, n)
}

export function keyAtEnd(existing: readonly { order: string }[]): string {
  let max: string | null = null
  for (const item of existing) if (max === null || item.order > max) max = item.order
  return generateKeyBetween(max, null)
}

export interface MoveUpdate {
  id: string
  order: string
  pinned: boolean
}

/**
 * Plans moving `movingIds` so they land at `targetIndex` of the visible list with the moving
 * items removed. Keys are chosen against the *global* order, so the moved items sit directly next
 * to their new visible neighbour in every other view too — not just the filtered one being edited.
 *
 * Dropping inside the pinned block pins; dropping inside the unpinned block unpins. On the exact
 * boundary the items keep their current state.
 */
export function planMove(
  visible: readonly Orderable[],
  all: readonly Orderable[],
  movingIds: readonly string[],
  targetIndex: number,
): MoveUpdate[] {
  const movingSet = new Set(movingIds)
  const moving = visible.filter((item) => movingSet.has(item.id))
  const first = moving[0]
  if (!first) return []
  const rest = visible.filter((item) => !movingSet.has(item.id))
  const index = Math.max(0, Math.min(targetIndex, rest.length))
  const prev = rest[index - 1]
  const next = rest[index]

  let pinned = first.pinned
  if (prev && next) pinned = prev.pinned === next.pinned ? prev.pinned : first.pinned
  else if (prev || next) pinned = (prev ?? next)!.pinned

  const global = all.filter((item) => !movingSet.has(item.id)).toSorted((a, b) => compareKeys(a.order, b.order))
  const position = (item: Orderable) => global.findIndex((g) => g.id === item.id)

  let lo: string | null
  let hi: string | null
  if (prev && prev.pinned === pinned) {
    lo = prev.order
    hi = global[position(prev) + 1]?.order ?? null
  } else if (next && next.pinned === pinned) {
    hi = next.order
    lo = global[position(next) - 1]?.order ?? null
  } else {
    // No neighbour in the target group: only the pinned state changes.
    return moving.map((item) => ({ id: item.id, order: item.order, pinned }))
  }

  const keys = generateNKeysBetween(lo, hi, moving.length)
  return moving.map((item, i) => ({ id: item.id, order: keys[i]!, pinned }))
}
