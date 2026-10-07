import { useDndContext } from "@dnd-kit/core"
import { rectSortingStrategy, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { ClipboardPaste } from "lucide-react"
import { Fragment, type MouseEvent, useCallback, useEffect, useMemo } from "react"
import { Kbd } from "@/components/ui/kbd"
import type { Clip } from "@/db/schema"
import { requestEdit } from "@/lib/ui-events"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"
import { ClipItem } from "./clip-item"

function timestampFor(clip: Clip, sort: string): number {
  return sort === "copied" ? (clip.copiedAt ?? clip.createdAt) : sort === "trash" ? (clip.deletedAt ?? clip.createdAt) : clip.createdAt
}

export function ClipList() {
  const { visible, canReorder, spaces, ready } = useData()
  const layout = useUi((s) => s.layout)
  const view = useUi((s) => s.view)
  const sort = useUi((s) => s.sort)
  const query = useUi((s) => s.query)
  const selected = useUi((s) => s.selected)
  const cursor = useUi((s) => s.cursor)
  const queue = useUi((s) => s.queue)
  const { active } = useDndContext()

  const ids = useMemo(() => visible.map((c) => c.id), [visible])
  const spaceNames = useMemo(() => new Map(spaces.map((s) => [s.id, s.name])), [spaces])

  const selectedSet = useMemo(() => new Set(selected), [selected])
  /** Copy order of a multi-selection follows the on-screen order. */
  const positions = useMemo(() => {
    const map = new Map<string, number>()
    const order = queue ? queue.ids : selected.length > 1 ? ids.filter((id) => selectedSet.has(id)) : []
    order.forEach((id, i) => map.set(id, i + 1))
    return map
  }, [ids, selected, selectedSet, queue])
  const queuedNext = queue?.ids[queue.index] ?? null

  const activeId = active?.data.current?.type === "clip" ? String(active.id) : null
  const draggingGroup = activeId !== null && selectedSet.has(activeId)

  const onSelect = useCallback(
    (id: string, event: MouseEvent) => {
      const mode = event.metaKey || event.ctrlKey ? "toggle" : event.shiftKey ? "range" : "replace"
      useUi.getState().select(id, mode, ids)
    },
    [ids],
  )
  const onOpen = useCallback((id: string) => {
    useUi.getState().setSelection([id], id)
    requestEdit()
  }, [])
  const onContextMenu = useCallback(
    (id: string) => {
      if (!useUi.getState().selected.includes(id)) useUi.getState().select(id, "replace", ids)
    },
    [ids],
  )

  // Keep the keyboard cursor on screen.
  useEffect(() => {
    if (!cursor) return
    document.querySelector(`[data-clip-id="${CSS.escape(cursor)}"]`)?.scrollIntoView({ block: "nearest" })
    // Switching layout moves the row, so it re-runs on `layout` too.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [cursor, layout])

  if (!ready) return <div className="flex-1" />
  if (!visible.length) return <EmptyList searching={Boolean(query)} trash={view.type === "trash"} />

  const firstUnpinned = visible.findIndex((c) => !c.pinned)
  const showSections = view.type !== "pinned" && view.type !== "trash" && visible[0]?.pinned && firstUnpinned > 0
  const timeKey = view.type === "trash" ? "trash" : sort

  const item = (clip: Clip) => (
    <ClipItem
      key={clip.id}
      clip={clip}
      layout={layout}
      selected={selectedSet.has(clip.id)}
      isCursor={cursor === clip.id}
      position={positions.get(clip.id) ?? null}
      queuedNext={queuedNext === clip.id}
      spaceName={view.type === "space" ? null : (clip.spaceId && spaceNames.get(clip.spaceId)) || null}
      timestamp={timestampFor(clip, timeKey)}
      sortable={canReorder}
      dragging={draggingGroup && clip.id !== activeId && selectedSet.has(clip.id)}
      onSelect={onSelect}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
    />
  )

  return (
    <div
      role="listbox"
      aria-multiselectable
      tabIndex={-1}
      className="@container min-h-0 flex-1 scrollbar-thin overflow-y-auto pb-24 outline-none"
      onClick={(e) => e.target === e.currentTarget && useUi.getState().clearSelection()}
    >
      <SortableContext items={ids} strategy={layout === "grid" ? rectSortingStrategy : verticalListSortingStrategy}>
        {layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-3 p-4">{visible.map(item)}</div>
        ) : (
          <div className="py-1.5">
            {visible.map((clip, i) => (
              <Fragment key={clip.id}>
                {showSections && i === 0 && <SectionLabel>Pinned</SectionLabel>}
                {showSections && i === firstUnpinned && <SectionLabel className="mt-2">Clips</SectionLabel>}
                {item(clip)}
              </Fragment>
            ))}
          </div>
        )}
      </SortableContext>
    </div>
  )
}

function SectionLabel({ children, className }: { children: string; className?: string }) {
  return <div className={`px-4.5 pt-1 pb-1.5 text-caption font-medium text-subtle ${className ?? ""}`}>{children}</div>
}

function EmptyList({ searching, trash }: { searching: boolean; trash: boolean }) {
  if (searching) return <div className="flex flex-1 items-center justify-center text-muted-foreground">No matches</div>
  if (trash) return <div className="flex flex-1 items-center justify-center text-muted-foreground">Trash is empty</div>
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-xs">
        <ClipboardPaste className="size-5 text-muted-foreground" strokeWidth={1.5} />
      </div>
      <div className="space-y-1">
        <p className="text-title font-medium">Paste anything</p>
        <p className="max-w-64 text-muted-foreground">Text, code, links, images, video, files. It stays here until you remove it.</p>
      </div>
      <div className="flex items-center gap-3 text-detail text-subtle">
        <span className="flex items-center gap-1.5">
          <Kbd>⌘</Kbd>
          <Kbd>V</Kbd> paste
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>N</Kbd> write
        </span>
        <span>or drop files</span>
      </div>
    </div>
  )
}
