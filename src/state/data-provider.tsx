import { useLiveQuery } from "dexie-react-hooks"
import { type ReactNode, useEffect, useMemo } from "react"
import { type Clip, type ClipKind, db } from "@/db/schema"
import { compareManual } from "@/lib/order"
import { useSearch } from "@/lib/search"
import { type Counts, type Data, DataContext } from "./data"
import { KIND_GROUPS, type KindGroup, type SortMode, useUi, type View } from "./ui"

const GROUP_OF = Object.fromEntries(Object.entries(KIND_GROUPS).flatMap(([group, kinds]) => kinds.map((kind) => [kind, group]))) as Record<
  ClipKind,
  KindGroup
>

function inView(clip: Clip, view: View): boolean {
  switch (view.type) {
    case "all":
      return true
    case "pinned":
      return clip.pinned
    case "kind":
      return GROUP_OF[clip.kind] === view.group
    case "space":
      return clip.spaceId === view.id
    case "trash":
      return false
  }
}

const by =
  <T,>(key: (item: T) => number) =>
  (a: T, b: T) =>
    key(b) - key(a)

function comparator(sort: SortMode): (a: Clip, b: Clip) => number {
  if (sort === "manual") return compareManual
  const inner =
    sort === "newest" ? by<Clip>((c) => c.createdAt) : sort === "oldest" ? by<Clip>((c) => -c.createdAt) : by<Clip>((c) => c.copiedAt ?? 0)
  return (a, b) => (a.pinned === b.pinned ? inner(a, b) : a.pinned ? -1 : 1)
}

function countClips(live: Clip[], trashed: Clip[]): Counts {
  const kinds = Object.fromEntries(Object.keys(KIND_GROUPS).map((g) => [g, 0])) as Record<KindGroup, number>
  const spaces: Record<string, number> = {}
  let pinned = 0
  for (const clip of live) {
    kinds[GROUP_OF[clip.kind]]++
    if (clip.pinned) pinned++
    if (clip.spaceId) spaces[clip.spaceId] = (spaces[clip.spaceId] ?? 0) + 1
  }
  return { all: live.length, pinned, trash: trashed.length, kinds, spaces }
}

function partition(clips: Clip[]) {
  const live: Clip[] = []
  const trashed: Clip[] = []
  const byId = new Map<string, Clip>()
  for (const clip of clips) {
    byId.set(clip.id, clip)
    if (clip.deletedAt === null) live.push(clip)
    else trashed.push(clip)
  }
  return { live, trashed, byId }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const clips = useLiveQuery(() => db.clips.toArray(), [])
  const spaceRows = useLiveQuery(() => db.spaces.orderBy("order").toArray(), [])
  const view = useUi((s) => s.view)
  const sort = useUi((s) => s.sort)
  const query = useUi((s) => s.query)

  const { live, trashed, byId } = useMemo(() => partition(clips ?? []), [clips])

  const hits = useSearch(view.type === "trash" ? trashed : live, query)
  const spaces = useMemo(() => spaceRows ?? [], [spaceRows])
  const counts = useMemo(() => countClips(live, trashed), [live, trashed])

  const visible = useMemo(() => {
    let list =
      view.type === "trash" ? trashed.toSorted(by((c) => c.deletedAt ?? 0)) : live.filter((c) => inView(c, view)).toSorted(comparator(sort))
    if (hits) list = list.filter((c) => hits.has(c.id))
    return list
  }, [live, trashed, view, sort, hits])

  // A view can disappear underneath us (space deleted in another tab); fall back gracefully.
  const missingSpace = spaceRows !== undefined && view.type === "space" && !spaces.some((s) => s.id === view.id)
  useEffect(() => {
    if (missingSpace) useUi.getState().setView({ type: "all" })
  }, [missingSpace])

  const value = useMemo<Data>(
    () => ({
      ready: clips !== undefined && spaceRows !== undefined,
      live,
      trashed,
      spaces,
      visible,
      byId,
      counts,
      canReorder: sort === "manual" && !hits && view.type !== "trash",
    }),
    [clips, spaceRows, live, trashed, spaces, visible, byId, counts, sort, hits, view.type],
  )

  return <DataContext value={value}>{children}</DataContext>
}
