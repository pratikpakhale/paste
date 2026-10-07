import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react"
import { Download, ImageOff } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getBlob } from "@/db/actions"
import { useBlobUrl } from "@/hooks/use-blob-url"
import { downloadBlob } from "@/lib/clipboard"
import { classifyMime } from "@/lib/detect"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { KIND_ICON } from "./kind-icons"

interface ImageAttrs {
  blob: string | null
  src: string | null
  alt: string | null
  title: string | null
  width: number | null
  height: number | null
}

export function ImageView({ node, selected }: ReactNodeViewProps) {
  const { blob, src, alt, title, width, height } = node.attrs as ImageAttrs
  const url = useBlobUrl(blob ?? undefined)
  const source = blob ? url : src
  // Known dimensions reserve the image's space before it loads, so the text below doesn't jump.
  const size = width && height ? { aspectRatio: `${width} / ${height}`, width: `min(100%, ${width}px)` } : undefined

  return (
    <NodeViewWrapper className="my-4" data-drag-handle>
      {source ? (
        <img
          src={source}
          alt={alt ?? ""}
          title={title ?? undefined}
          draggable={false}
          style={size}
          className={cn(
            "not-prose m-0 block h-auto max-w-full rounded-md",
            selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        />
      ) : (
        <div
          style={size}
          className={cn(
            "flex min-h-24 w-full max-w-sm items-center justify-center rounded-md bg-muted text-subtle",
            selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
          )}
        >
          <ImageOff className="size-5 stroke-[1.5]" aria-label={alt || "Image"} />
        </div>
      )}
    </NodeViewWrapper>
  )
}

interface AttachmentAttrs {
  blob: string | null
  name: string
  mime: string
  size: number
}

export function AttachmentView({ node, selected }: ReactNodeViewProps) {
  const { blob, name, mime, size } = node.attrs as AttachmentAttrs
  const Icon = KIND_ICON[classifyMime(mime)]

  const download = async () => {
    const data = blob ? await getBlob(blob) : undefined
    if (!data) return void toast.error("This file is no longer available")
    downloadBlob(data, name)
  }

  return (
    <NodeViewWrapper className="my-3" data-drag-handle>
      <div
        className={cn(
          "not-prose flex w-full max-w-md items-center gap-3 rounded-lg border bg-card p-2.5 text-base",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon className="size-4 stroke-[1.5] text-muted-foreground" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-snug">
          <span className="truncate font-medium">{name}</span>
          <span className="truncate text-detail text-subtle">{formatBytes(size)}</span>
        </span>
        <Button variant="ghost" size="icon-sm" aria-label={`Download ${name}`} title="Download" onClick={() => void download()}>
          <Download />
        </Button>
      </div>
    </NodeViewWrapper>
  )
}
