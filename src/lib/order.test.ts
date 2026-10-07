import { describe, expect, test } from "bun:test"
import { generateNKeysBetween } from "fractional-indexing"
import { compareManual, keyAtEnd, keysAtTop, type Orderable, planMove } from "./order"

/** Builds items in global order; ids prefixed with `*` are pinned. */
function items(spec: string): Orderable[] {
  const ids = spec.split(" ")
  const keys = generateNKeysBetween(null, null, ids.length)
  return ids.map((raw, i) => ({ id: raw.replace("*", ""), order: keys[i]!, pinned: raw.startsWith("*") }))
}

/** Applies a move plan and returns the ids in manual order, pinned marked with `*`. */
function apply(all: Orderable[], updates: ReturnType<typeof planMove>): string {
  const byId = new Map(updates.map((u) => [u.id, u]))
  return all
    .map((item) => ({ ...item, ...byId.get(item.id) }))
    .toSorted(compareManual)
    .map((item) => (item.pinned ? `*${item.id}` : item.id))
    .join(" ")
}

const view = (all: Orderable[], ids: string) => ids.split(" ").map((id) => all.find((item) => item.id === id)!)

describe("keysAtTop / keyAtEnd", () => {
  test("new keys sort before or after everything, in the given order", () => {
    const all = items("a b c")
    const top = keysAtTop(all, 2)
    expect(top[0]! < top[1]!).toBe(true)
    expect(top[1]! < all[0]!.order).toBe(true)
    expect(keyAtEnd(all) > all[2]!.order).toBe(true)
  })
  test("work on an empty list", () => {
    expect(keysAtTop([], 3)).toHaveLength(3)
    expect(keyAtEnd([])).toBeString()
  })
})

describe("planMove", () => {
  test("moves a single item down", () => {
    const all = items("a b c d")
    expect(apply(all, planMove(all, all, ["a"], 2))).toBe("b c a d")
  })

  test("moves a single item to the top and bottom", () => {
    const all = items("a b c d")
    expect(apply(all, planMove(all, all, ["c"], 0))).toBe("c a b d")
    expect(apply(all, planMove(all, all, ["b"], 3))).toBe("a c d b")
  })

  test("moves a non-contiguous selection together, keeping its relative order", () => {
    const all = items("a b c d e")
    expect(apply(all, planMove(all, all, ["d", "a"], 1))).toBe("b a d c e")
  })

  test("in a filtered view, lands directly after the visible neighbour globally", () => {
    const all = items("a x b y c")
    const visible = view(all, "a b c")
    // Put c between a and b in the filtered view: it must follow a, ahead of the hidden x.
    expect(apply(all, planMove(visible, all, ["c"], 1))).toBe("a c x b y")
  })

  test("dropping into the pinned block pins", () => {
    const all = items("*p *q a b")
    const visible = all.toSorted(compareManual)
    expect(apply(all, planMove(visible, all, ["b"], 1))).toBe("*p *b *q a")
  })

  test("dropping into the unpinned block unpins", () => {
    const all = items("*p *q a b")
    const visible = all.toSorted(compareManual)
    expect(apply(all, planMove(visible, all, ["p"], 2))).toBe("*q a p b")
  })

  test("on the pinned boundary, items keep their state", () => {
    const all = items("*p *q a b")
    const visible = all.toSorted(compareManual)
    expect(apply(all, planMove(visible, all, ["b"], 2))).toBe("*p *q b a")
    expect(apply(all, planMove(visible, all, ["p"], 1))).toBe("*q *p a b")
  })

  test("only the moving items change", () => {
    const all = items("a b c d")
    const updates = planMove(all, all, ["d"], 0)
    expect(updates.map((u) => u.id)).toEqual(["d"])
  })

  test("nothing to move returns no updates", () => {
    const all = items("a b")
    expect(planMove(all, all, ["zzz"], 0)).toEqual([])
  })

  test("out-of-range targets clamp", () => {
    const all = items("a b c")
    expect(apply(all, planMove(all, all, ["a"], 99))).toBe("b c a")
    expect(apply(all, planMove(all, all, ["c"], -5))).toBe("c a b")
  })
})
