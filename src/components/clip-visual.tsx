import { type Clip, isFileClip } from "@/db/schema"
import { useBlobUrl } from "@/hooks/use-blob-url"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "./kind-icons"

/** The small leading visual of a row: a real thumbnail or swatch where possible, else the kind icon. */
export function ClipThumb({ clip, className }: { clip: Clip; className?: string }) {
  const thumbId = isFileClip(clip) && clip.kind === "image" ? (clip.thumbId ?? clip.blobId) : isFileClip(clip) ? clip.thumbId : undefined
  const url = useBlobUrl(thumbId)

  if (clip.kind === "color" && !isFileClip(clip)) {
    return (
      <span
        className={cn("size-5.5 shrink-0 rounded-[5px] shadow-[inset_0_0_0_1px_oklch(0_0_0/0.12)]", className)}
        style={{ background: clip.text.trim() }}
      />
    )
  }
  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className={cn("size-5.5 shrink-0 rounded-[4px] object-cover shadow-[0_0_0_1px_var(--border)]", className)}
      />
    )
  }
  const Icon = KIND_ICON[clip.kind]
  return <Icon className={cn("size-4 shrink-0 text-subtle", className)} strokeWidth={1.75} />
}

const SPACE_COLORS = [
  "oklch(0.68 0.15 274)",
  "oklch(0.7 0.14 160)",
  "oklch(0.74 0.14 70)",
  "oklch(0.68 0.17 20)",
  "oklch(0.7 0.13 220)",
  "oklch(0.68 0.16 320)",
  "oklch(0.72 0.12 120)",
]

function spaceColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return SPACE_COLORS[Math.abs(hash) % SPACE_COLORS.length]!
}

export function SpaceDot({ id, className }: { id: string; className?: string }) {
  return <span className={cn("size-2 shrink-0 rounded-full", className)} style={{ background: spaceColor(id) }} />
}
