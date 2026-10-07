import { Download, ExternalLink, Maximize2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { updateClip } from "@/db/actions"
import type { FileClip, TextClip } from "@/db/schema"
import { useBlobUrl } from "@/hooks/use-blob-url"
import { highlight, MAX_HIGHLIGHT_CHARS } from "@/lib/code"
import { formatBytes } from "@/lib/format"
import { onEditRequest } from "@/lib/ui-events"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { KIND_ICON } from "./kind-icons"

/** Text editor that autosaves. Local edits win while focused; outside edits flow in otherwise. */
export function TextEditor({ clip, mono, autoFocus }: { clip: TextClip; mono?: boolean; autoFocus?: boolean }) {
  const [value, setValue] = useState(clip.text)
  const [seen, setSeen] = useState(clip.text)
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const pending = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(clip.text)

  // Adopt changes made elsewhere (another tab, "Format source") unless the user is mid-edit.
  if (clip.text !== seen) {
    setSeen(clip.text)
    if (!focused) setValue(clip.text)
  }

  const save = (text: string) => {
    clearTimeout(pending.current)
    pending.current = undefined
    if (text !== clip.text) void updateClip(clip.id, { text })
  }

  const change = (text: string) => {
    setValue(text)
    latest.current = text
    clearTimeout(pending.current)
    pending.current = setTimeout(() => save(text), 350)
  }

  useEffect(() => onEditRequest(() => ref.current?.focus()), [])
  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  // Switching clips mid-typing must not drop the last keystrokes.
  useEffect(
    () => () => {
      if (pending.current === undefined) return
      clearTimeout(pending.current)
      void updateClip(clip.id, { text: latest.current })
    },
    [clip.id],
  )

  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={!mono}
      onChange={(e) => change(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        save(value)
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") e.currentTarget.blur()
        if (e.key === "Tab" && mono && !e.shiftKey) {
          e.preventDefault()
          const el = e.currentTarget
          el.setRangeText("  ", el.selectionStart, el.selectionEnd, "end")
          change(el.value)
        }
      }}
      className={cn(
        "block [field-sizing:content] min-h-full w-full resize-none bg-transparent px-6 py-5 outline-none placeholder:text-subtle",
        mono ? "font-mono text-[12.5px] leading-[1.6]" : "text-[14px] leading-[1.65]",
      )}
      placeholder="Empty"
    />
  )
}

export function CodeView({ code, language }: { code: string; language?: string }) {
  const [html, setHtml] = useState<{ for: string; html: string } | null>(null)
  const key = `${language}\u0000${code}`
  const tooBig = code.length > MAX_HIGHLIGHT_CHARS

  useEffect(() => {
    if (tooBig) return
    let cancelled = false
    void highlight(code, language).then((result) => !cancelled && setHtml({ for: key, html: result }))
    return () => {
      cancelled = true
    }
  }, [code, language, key, tooBig])

  const className = "selectable px-6 py-5 font-mono text-[12.5px] leading-[1.6] [&_pre]:whitespace-pre-wrap [&_pre]:break-words"
  if (html && html.for === key) return <div className={className} dangerouslySetInnerHTML={{ __html: html.html }} />
  return (
    <div className={className}>
      <pre>{code}</pre>
    </div>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  a: ({ node, children, ...props }) => (
    <a {...props} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
}

export function MarkdownView({ text }: { text: string }) {
  return (
    <div className="selectable prose prose-sm max-w-none px-6 py-5 text-[14px] dark:prose-invert prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export function JsonView({ clip }: { clip: TextClip }) {
  const pretty = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(clip.text), null, 2)
    } catch {
      return null
    }
  }, [clip.text])

  return (
    <div>
      {pretty === null && <p className="px-6 pt-4 text-[12px] text-destructive">Invalid JSON — showing as-is.</p>}
      {pretty !== null && pretty !== clip.text && (
        <div className="flex justify-end px-4 pt-3">
          <Button variant="outline" size="xs" onClick={() => void updateClip(clip.id, { text: pretty })}>
            Format source
          </Button>
        </div>
      )}
      <CodeView code={pretty ?? clip.text} language="json" />
    </div>
  )
}

export function LinkView({ clip }: { clip: TextClip }) {
  const url = URL.parse(clip.text.trim())
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      <a
        href={url?.href}
        target="_blank"
        rel="noreferrer"
        className="group flex items-center gap-3 rounded-lg border bg-card p-3.5 transition-colors hover:border-foreground/15"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-[15px] font-semibold text-muted-foreground uppercase">
          {url?.hostname.replace(/^www\./, "")[0] ?? "?"}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{url?.hostname.replace(/^www\./, "") ?? clip.text}</span>
          <span className="truncate text-[12px] text-subtle">{url ? `${url.pathname}${url.search}${url.hash}` : ""}</span>
        </span>
        <ExternalLink className="size-4 text-subtle transition-colors group-hover:text-foreground" />
      </a>
      <div className="-mx-6 border-t">
        <TextEditor clip={clip} mono />
      </div>
    </div>
  )
}

/** Normalises any CSS colour through a canvas to get stable hex/rgb values. */
function resolveColor(value: string): { hex: string; rgb: string; alpha: number } | null {
  if (!CSS.supports("color", value)) return null
  const ctx = new OffscreenCanvas(1, 1).getContext("2d")
  if (!ctx) return null
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data
  const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`
  return { hex, rgb: a === 255 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(2)})`, alpha: a / 255 }
}

const copy = (text: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${text}`))

export function ColorView({ clip }: { clip: TextClip }) {
  const value = clip.text.trim()
  const resolved = useMemo(() => resolveColor(value), [value])

  return (
    <div className="flex flex-col gap-5 px-6 py-5">
      <div className="checkerboard overflow-hidden rounded-xl border">
        <div className="h-44" style={{ background: value }} />
      </div>
      {resolved && (
        <div className="grid grid-cols-3 gap-2">
          {[
            ["Original", value],
            ["HEX", resolved.hex],
            ["RGB", resolved.rgb],
          ].map(([label, text]) => (
            <button
              key={label}
              type="button"
              onClick={() => copy(text!)}
              className="flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <span className="text-[11px] text-subtle">{label}</span>
              <span className="w-full truncate font-mono text-[12px]">{text}</span>
            </button>
          ))}
        </div>
      )}
      <div className="-mx-6 border-t">
        <TextEditor clip={clip} mono />
      </div>
    </div>
  )
}

export function ImageView({ clip }: { clip: FileClip }) {
  const url = useBlobUrl(clip.blobId)
  const [zoom, setZoom] = useState(false)
  if (!url) return null
  return (
    <div className="flex h-full flex-col p-4">
      <button
        type="button"
        onClick={() => setZoom(true)}
        className="checkerboard group relative flex min-h-0 flex-1 cursor-zoom-in items-center justify-center overflow-hidden rounded-lg border"
      >
        <img src={url} alt={clip.file.name} className="max-h-full max-w-full object-contain" draggable={false} />
        <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-md bg-background/80 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
          <Maximize2 className="size-3.5" />
        </span>
      </button>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[92vh] w-[94vw] max-w-none items-center justify-center border-0 bg-transparent p-0 shadow-none ring-0 sm:max-w-none"
          onClick={() => setZoom(false)}
        >
          <DialogTitle className="sr-only">{clip.file.name}</DialogTitle>
          <img src={url} alt={clip.file.name} className="max-h-full max-w-full rounded-md object-contain shadow-2xl" />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function MediaView({ clip }: { clip: FileClip }) {
  const url = useBlobUrl(clip.blobId)
  if (!url) return null
  if (clip.kind === "video") {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <video src={url} controls className="max-h-full max-w-full rounded-lg border bg-black" />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4 px-6 py-8">
      <FileCard clip={clip} />
      <audio src={url} controls className="w-full" />
    </div>
  )
}

export function PdfView({ clip }: { clip: FileClip }) {
  const url = useBlobUrl(clip.blobId)
  if (!url) return null
  // A sandboxed frame can't host the browser's PDF viewer; the source is the user's own local file.
  // oxlint-disable-next-line react/iframe-missing-sandbox
  return <iframe src={url} title={clip.file.name} className="size-full border-0 bg-white" />
}

export function FileCard({ clip }: { clip: FileClip }) {
  const actions = useActions()
  const Icon = KIND_ICON[clip.kind]
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
        <Icon className="size-5 text-muted-foreground" strokeWidth={1.5} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{clip.file.name}</span>
        <span className="truncate text-[12px] text-subtle">
          {formatBytes(clip.file.size)} · {clip.file.mime}
        </span>
      </span>
      <Button variant="outline" size="sm" onClick={() => void actions.download([clip.id])}>
        <Download /> Download
      </Button>
    </div>
  )
}
