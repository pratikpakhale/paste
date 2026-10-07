import { ClipboardPaste, CornerDownLeft, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { hasTransferContent, readTransfer } from "@/lib/clipboard"
import { clipLabel } from "@/lib/format"
import { useActions } from "@/state/actions"
import { useConfirmState } from "@/state/confirm"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"
import { ClipThumb, SpaceDot } from "./clip-visual"
import { viewTitle } from "./views"

export function Composer() {
  const open = useUi((s) => s.overlay === "composer")
  const view = useUi((s) => s.view)
  const { spaces } = useData()
  const actions = useActions()
  const [text, setText] = useState("")

  const close = () => {
    useUi.getState().setOverlay(null)
    setText("")
  }
  const save = () => {
    if (text.trim()) void actions.ingest([{ type: "text", text }])
    close()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false} className="top-[16%] translate-y-0 gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="flex-row items-center gap-2 border-b px-4 py-3">
          <DialogTitle className="text-base font-medium">New clip</DialogTitle>
          <DialogDescription className="sr-only">Write a clip. Its type is detected when saved.</DialogDescription>
          {view.type === "space" && (
            <span className="flex items-center gap-1.5 rounded-full border px-2 py-px text-caption text-muted-foreground">
              <SpaceDot id={view.id} className="size-1.5" />
              {viewTitle(view, spaces)}
            </span>
          )}
        </DialogHeader>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              save()
            }
          }}
          placeholder="Write or paste… type is detected automatically"
          className="[field-sizing:content] max-h-[55vh] min-h-48 resize-none bg-transparent px-4 py-3.5 text-title leading-relaxed outline-none placeholder:text-subtle"
        />
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2.5">
          <Button variant="ghost" size="sm" onClick={close}>
            Cancel
          </Button>
          <Button size="sm" disabled={!text.trim()} onClick={save}>
            Save
            <Kbd className="-mr-1 bg-white/15 text-primary-foreground">⌘↵</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const SHORTCUTS: { group: string; items: [string, string][] }[] = [
  {
    group: "Capture",
    items: [
      ["⌘ V", "Paste as a new clip"],
      ["N", "Write a new clip"],
      ["Drop", "Files, images or text anywhere"],
    ],
  },
  {
    group: "Navigate",
    items: [
      ["J / ↓", "Next clip"],
      ["K / ↑", "Previous clip"],
      ["⇧ J / ⇧ K", "Extend selection"],
      ["⌘ A", "Select all"],
      ["/", "Filter this view"],
      ["⌘ K", "Search everything & commands"],
      ["G then A · P · T", "All · Pinned · Trash"],
      ["[ / ⌘ \\", "Toggle sidebar"],
    ],
  },
  {
    group: "Copy",
    items: [
      ["↵ / ⌘ C", "Copy (all selected as one)"],
      ["⇧ ↵", "Copy selected joined by line"],
      ["Q", "Copy selected one by one"],
      ["↵ during queue", "Copy the next one"],
    ],
  },
  {
    group: "Organize",
    items: [
      ["⌥ ↑ / ⌥ ↓", "Move up / down"],
      ["⌥ ⇧ ↑ / ⌥ ⇧ ↓", "Move to top / bottom"],
      ["P", "Pin / unpin"],
      ["M", "Move to space"],
      ["E", "Edit content"],
      ["R", "Rename (restore in trash)"],
      ["D", "Download"],
      ["⌫", "Move to trash"],
    ],
  },
]

export function ShortcutsDialog() {
  const open = useUi((s) => s.overlay === "shortcuts")
  return (
    <Dialog open={open} onOpenChange={(next) => !next && useUi.getState().setOverlay(null)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything in Paste is reachable from the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-x-8 gap-y-5">
          {SHORTCUTS.map(({ group, items }) => (
            <div key={group} className="flex flex-col gap-1.5">
              <span className="text-caption font-medium text-subtle">{group}</span>
              {items.map(([keys, label]) => (
                <div key={label} className="flex items-center justify-between gap-3 text-detail">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="flex shrink-0 gap-1">
                    {/* Tokens repeat within a shortcut (⌥ ⇧ ↑ / ⌥ ⇧ ↓) and the list is static, so position is the identity. */}
                    {/* oxlint-disable react/no-array-index-key */}
                    {keys.split(" ").map((k, i) =>
                      k.length === 1 || /^[⌘⌥⇧↵⌫↑↓]/.test(k) || k === "Drop" || k === "Esc" ? (
                        <Kbd key={i}>{k}</Kbd>
                      ) : (
                        <span key={i} className="text-caption text-subtle">
                          {k}
                        </span>
                      ),
                    )}
                    {/* oxlint-enable react/no-array-index-key */}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog() {
  const request = useConfirmState((s) => s.request)
  const settle = (ok: boolean) => {
    request?.resolve(ok)
    useConfirmState.setState({ request: null })
  }
  return (
    <AlertDialog open={request !== null} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{request?.title}</AlertDialogTitle>
          <AlertDialogDescription>{request?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => settle(true)}>
            {request?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Floating status for "copy one by one": shows progress and what ↵ will copy next. */
export function QueueBar() {
  const queue = useUi((s) => s.queue)
  const { byId } = useData()
  const actions = useActions()
  if (!queue) return null
  const next = byId.get(queue.ids[queue.index] ?? "")

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center">
      <div className="pointer-events-auto flex animate-in items-center gap-3 rounded-xl border bg-popover py-1.5 pr-1.5 pl-3.5 shadow-xl fade-in slide-in-from-bottom-2">
        <div className="flex items-center gap-1">
          {queue.ids.map((id, i) => (
            <span
              key={id}
              className={`h-1.5 rounded-full transition-all ${i < queue.index ? "w-1.5 bg-primary" : i === queue.index ? "w-4 bg-primary/60" : "w-1.5 bg-border"}`}
            />
          ))}
        </div>
        <span className="text-detail text-muted-foreground tabular-nums">
          {queue.index} of {queue.ids.length} copied
        </span>
        {next && (
          <Button size="sm" variant="secondary" className="max-w-64" onClick={() => void actions.copyNextInQueue()}>
            <ClipThumb clip={next} className="size-3.5" />
            <span className="truncate">Copy “{clipLabel(next)}”</span>
            <CornerDownLeft className="opacity-60" />
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" aria-label="Stop" onClick={() => useUi.getState().setQueue(null)}>
          <X />
        </Button>
      </div>
    </div>
  )
}

/** Full-window target shown while files or text are dragged in from outside the app. */
export function DropZone() {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const actions = useActions()
  const { spaces } = useData()
  const view = useUi((s) => s.view)

  useEffect(() => {
    // `dragstart` only fires for drags that begin inside this page (e.g. selected text).
    let internal = false
    const start = () => (internal = true)
    const end = () => (internal = false)
    const external = (e: DragEvent) => !internal && hasTransferContent(e.dataTransfer)
    const enter = (e: DragEvent) => {
      if (!external(e)) return
      e.preventDefault()
      depth.current++
      setActive(true)
    }
    const over = (e: DragEvent) => {
      if (!external(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"
    }
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const drop = (e: DragEvent) => {
      depth.current = 0
      setActive(false)
      if (!e.dataTransfer || !external(e)) return
      e.preventDefault()
      void actions.ingest(readTransfer(e.dataTransfer))
    }
    window.addEventListener("dragstart", start)
    window.addEventListener("dragend", end)
    window.addEventListener("dragenter", enter)
    window.addEventListener("dragover", over)
    window.addEventListener("dragleave", leave)
    window.addEventListener("drop", drop)
    return () => {
      window.removeEventListener("dragstart", start)
      window.removeEventListener("dragend", end)
      window.removeEventListener("dragenter", enter)
      window.removeEventListener("dragover", over)
      window.removeEventListener("dragleave", leave)
      window.removeEventListener("drop", drop)
    }
  }, [actions])

  if (!active) return null
  const target = view.type === "space" ? viewTitle(view, spaces) : "All clips"
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex animate-in items-center justify-center bg-background/70 backdrop-blur-sm fade-in">
      <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-card/80 px-14 py-10 shadow-2xl">
        <ClipboardPaste className="size-7 text-primary" strokeWidth={1.5} />
        <span className="text-title font-medium">Drop to add to {target}</span>
      </div>
    </div>
  )
}
