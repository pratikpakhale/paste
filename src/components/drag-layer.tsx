import {
  type Active,
  closestCenter,
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { type ReactNode, useState } from "react"
import { applyMove, reorderSpaces, setPinned } from "@/db/actions"
import { generateKeyBetween } from "fractional-indexing"
import { clipLabel } from "@/lib/format"
import { planMove } from "@/lib/order"
import { useActions } from "@/state/actions"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"
import { ClipThumb, SpaceDot } from "./clip-visual"

export type DropTarget = { type: "target"; action: "pin" | "trash" | "unspace" } | { type: "space"; spaceId: string }

/**
 * Clip drags hit sidebar targets only when the pointer is actually over them; otherwise they sort
 * within the list. Space drags only ever sort among spaces.
 */
const collision: CollisionDetection = (args) => {
  const kind = args.active.data.current?.type
  const by = (type: string) => args.droppableContainers.filter((c) => c.data.current?.type === type)
  if (kind === "space") return closestCenter({ ...args, droppableContainers: by("space") })
  const targets = pointerWithin({ ...args, droppableContainers: [...by("space"), ...by("target")] })
  if (targets.length) return targets
  return closestCenter({ ...args, droppableContainers: by("clip") })
}

export function DragLayer({ children }: { children: ReactNode }) {
  const data = useData()
  const actions = useActions()
  const [dragged, setDraggedState] = useState<Active | null>(null)
  const setDragged = (active: Active | null) => {
    setDraggedState(active)
    // Lets index.css hold the grabbing cursor over everything until the drop.
    document.documentElement.toggleAttribute("data-dragging", active !== null)
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  /** Dragging a selected clip drags the whole selection, in on-screen order. */
  const movingFor = (activeId: string): string[] => {
    const { selected } = useUi.getState()
    if (!selected.includes(activeId)) return [activeId]
    const set = new Set(selected)
    return data.visible.filter((c) => set.has(c.id)).map((c) => c.id)
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null)
    if (!over) return
    const activeId = String(active.id)

    if (active.data.current?.type === "space") {
      const ids = data.spaces.map((s) => s.id)
      const from = ids.indexOf(activeId.slice("space:".length))
      const to = ids.indexOf(String(over.id).slice("space:".length))
      if (from === -1 || to === -1 || from === to) return
      // With the dragged space removed, index `to` is right where it should land in either direction.
      const rest = data.spaces.filter((_, i) => i !== from)
      const order = generateKeyBetween(rest[to - 1]?.order ?? null, rest[to]?.order ?? null)
      void reorderSpaces([{ id: data.spaces[from]!.id, order }])
      return
    }

    const moving = movingFor(activeId)
    const target = over.data.current as DropTarget | { type: "clip" } | undefined
    if (target?.type === "space") return void actions.moveTo(target.spaceId, moving)
    if (target?.type === "target") {
      if (target.action === "trash") return void actions.trash(moving)
      if (target.action === "unspace") return void actions.moveTo(null, moving)
      return void setPinned(moving, true)
    }

    const overId = String(over.id)
    if (!data.canReorder || moving.includes(overId)) return
    const ids = data.visible.map((c) => c.id)
    const rest = ids.filter((id) => !moving.includes(id))
    const overIndex = rest.indexOf(overId)
    if (overIndex === -1) return
    const insertAt = ids.indexOf(overId) > ids.indexOf(activeId) ? overIndex + 1 : overIndex
    void applyMove(planMove(data.visible, data.live, moving, insertAt))
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
      onDragStart={(e) => setDragged(e.active)}
      onDragCancel={() => setDragged(null)}
      onDragEnd={onDragEnd}
    >
      {children}
      <DragOverlay dropAnimation={null}>{dragged ? <Preview active={dragged} moving={movingFor(String(dragged.id))} /> : null}</DragOverlay>
    </DndContext>
  )
}

function Preview({ active, moving }: { active: Active; moving: string[] }) {
  const { byId, spaces } = useData()

  if (active.data.current?.type === "space") {
    const space = spaces.find((s) => `space:${s.id}` === active.id)
    if (!space) return null
    return (
      <div className="flex h-7 w-52 items-center gap-2.5 rounded-md border bg-popover px-2.5 shadow-lg">
        <SpaceDot id={space.id} />
        {space.name}
      </div>
    )
  }

  const clip = byId.get(String(active.id))
  if (!clip) return null
  return (
    <div className="relative w-fit">
      {moving.length > 1 && <div className="absolute inset-0 translate-x-1 translate-y-1 rounded-md border bg-popover" />}
      <div className="relative flex h-8 max-w-72 items-center gap-2 rounded-md border bg-popover pr-3 pl-2.5 shadow-lg">
        <ClipThumb clip={clip} />
        <span className="truncate">{clipLabel(clip)}</span>
        {moving.length > 1 && (
          <span className="ml-1 rounded-full bg-primary px-1.5 text-micro font-medium text-primary-foreground tabular-nums">
            {moving.length}
          </span>
        )}
      </div>
    </div>
  )
}
