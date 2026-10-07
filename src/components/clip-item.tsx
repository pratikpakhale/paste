import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { Pin, Play } from "lucide-react"
import { type CSSProperties, memo, type MouseEvent } from "react"
import { cn } from "@/lib/utils"
import { type Clip, isFileClip } from "@/db/schema"
import { useBlobUrl } from "@/hooks/use-blob-url"
import { clipDetail, clipLabel, formatAgo } from "@/lib/format"
import { ClipMenu } from "./clip-menu"
import { ClipThumb, SpaceDot } from "./clip-visual"
import { KIND_ICON } from "./kind-icons"

export interface ClipItemProps {
  clip: Clip
  layout: "list" | "grid"
  selected: boolean
  isCursor: boolean
  /** 1-based copy position when several clips are selected. */
  position: number | null
  /** Highlighted as the next clip a running copy queue will copy. */
  queuedNext: boolean
  spaceName: string | null
  timestamp: number
  sortable: boolean
  /** Another selected clip is being dragged, so this one travels with it. */
  dragging: boolean
  onSelect: (id: string, event: MouseEvent) => void
  onOpen: (id: string) => void
  onContextMenu: (id: string) => void
}

export const ClipItem = memo(function ClipItem(props: ClipItemProps) {
  const { clip, layout, sortable, dragging, onSelect, onOpen, onContextMenu } = props
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: clip.id,
    data: { type: "clip" },
    disabled: !sortable,
  })

  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const Body = layout === "grid" ? CardBody : RowBody

  return (
    <ClipMenu clipId={clip.id} onOpen={onContextMenu}>
      <div
        ref={setNodeRef}
        style={style}
        data-clip-id={clip.id}
        {...attributes}
        {...listeners}
        tabIndex={-1}
        role="option"
        aria-selected={props.selected}
        onClick={(e) => onSelect(clip.id, e)}
        onDoubleClick={() => onOpen(clip.id)}
        className={cn("outline-none", layout === "list" && "clip-row", (isDragging || dragging) && "opacity-40", isDragging && "z-10")}
      >
        <Body {...props} />
      </div>
    </ClipMenu>
  )
})

function Position({ value, active }: { value: number; active?: boolean }) {
  return (
    <span
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-micro font-medium tabular-nums",
        active ? "bg-primary text-primary-foreground" : "bg-primary/15 text-primary",
      )}
    >
      {value}
    </span>
  )
}

function RowBody({ clip, selected, isCursor, position, queuedNext, spaceName, timestamp }: ClipItemProps) {
  return (
    <div
      className={cn(
        "group relative mx-2 flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 transition-colors duration-75",
        selected ? "bg-selected" : "hover:bg-accent/60",
      )}
    >
      {isCursor && selected && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
      <ClipThumb clip={clip} />
      <span className="min-w-0 shrink truncate text-foreground">{clipLabel(clip)}</span>
      <span className="min-w-0 flex-1 truncate text-detail text-subtle">{clipDetail(clip)}</span>
      {queuedNext && <span className="text-caption font-medium text-primary">next</span>}
      {position !== null && <Position value={position} active={queuedNext} />}
      {spaceName && clip.spaceId && (
        <span className="hidden max-w-28 shrink-0 items-center gap-1.5 truncate rounded-full border px-2 py-px text-caption text-muted-foreground @[600px]:flex">
          <SpaceDot id={clip.spaceId} className="size-1.5" />
          <span className="truncate">{spaceName}</span>
        </span>
      )}
      {clip.pinned && <Pin className="size-3 shrink-0 rotate-45 text-subtle" />}
      <span className="w-11 shrink-0 text-right text-caption text-subtle tabular-nums">{formatAgo(timestamp)}</span>
    </div>
  )
}

function CardPreview({ clip }: { clip: Clip }) {
  const thumbId = isFileClip(clip) ? (clip.kind === "image" ? (clip.thumbId ?? clip.blobId) : clip.thumbId) : undefined
  const url = useBlobUrl(thumbId)

  if (url) {
    return (
      <div className="relative size-full">
        <img src={url} alt="" draggable={false} className="size-full object-cover" />
        {clip.kind === "video" && (
          <span className="absolute inset-0 m-auto flex size-8 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
            <Play className="size-3.5 fill-current" />
          </span>
        )}
      </div>
    )
  }
  if (!isFileClip(clip)) {
    if (clip.kind === "color") return <div className="size-full" style={{ background: clip.text.trim() }} />
    if (clip.kind === "link") {
      const link = URL.parse(clip.text.trim())
      return (
        <div className="flex size-full flex-col justify-end gap-0.5 p-3">
          <span className="truncate text-base font-medium">{link?.hostname.replace(/^www\./, "") ?? clip.text}</span>
          <span className="truncate text-caption text-subtle">{link?.pathname}</span>
        </div>
      )
    }
    const mono = clip.kind === "code" || clip.kind === "json"
    return (
      <div
        className={cn(
          "size-full overflow-hidden [mask-image:linear-gradient(to_bottom,black_60%,transparent)] p-3 text-caption leading-[1.45] whitespace-pre-wrap text-muted-foreground",
          mono ? "font-mono text-micro" : "break-words",
        )}
      >
        {clip.text.slice(0, 600)}
      </div>
    )
  }
  const Icon = KIND_ICON[clip.kind]
  const ext = clip.file.name.split(".").pop()?.toUpperCase()
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 text-subtle">
      <Icon className="size-7" strokeWidth={1.25} />
      {ext && ext.length <= 5 && <span className="text-micro font-medium tracking-wide">{ext}</span>}
    </div>
  )
}

function CardBody({ clip, selected, isCursor, position, queuedNext, timestamp }: ClipItemProps) {
  return (
    <div
      className={cn(
        "group flex cursor-default flex-col overflow-hidden rounded-lg border bg-card transition-[box-shadow,border-color] duration-100",
        selected ? "border-primary/60 ring-2 ring-primary/25" : "hover:border-foreground/15",
        isCursor && selected && "border-primary",
      )}
    >
      <div className="relative aspect-[4/3] overflow-hidden border-b bg-muted/40">
        <CardPreview clip={clip} />
        <div className="absolute top-2 right-2 flex items-center gap-1">
          {clip.pinned && (
            <span className="flex size-5 items-center justify-center rounded-full bg-background/80 backdrop-blur">
              <Pin className="size-3 rotate-45 text-muted-foreground" />
            </span>
          )}
          {position !== null && <Position value={position} active={queuedNext} />}
        </div>
      </div>
      <div className="flex h-9 items-center gap-2 px-2.5">
        <ClipThumb clip={clip} className="size-3.5" />
        <span className="min-w-0 flex-1 truncate text-detail">{clipLabel(clip)}</span>
        <span className="shrink-0 text-caption text-subtle tabular-nums">{formatAgo(timestamp)}</span>
      </div>
    </div>
  )
}
