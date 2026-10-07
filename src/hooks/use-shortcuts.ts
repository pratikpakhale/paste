import { useEffect } from "react"
import { type Options, useHotkeys } from "react-hotkeys-hook"
import { readTransfer } from "@/lib/clipboard"
import { requestEdit, requestRename, requestSearch } from "@/lib/ui-events"
import type { Actions } from "@/state/actions"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}

/** Menus and dialogs own their keyboard; global shortcuts must not fire underneath them. */
function insideOverlay(e: KeyboardEvent): boolean {
  return e.target instanceof Element && e.target.closest('[role="menu"],[role="dialog"],[role="alertdialog"]') !== null
}

function hasTextSelection(): boolean {
  return Boolean(window.getSelection()?.toString())
}

/** ⌘V anywhere outside a text field becomes a new clip. */
export function usePasteCapture(actions: Actions) {
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !e.clipboardData) return
      if (useUi.getState().overlay !== null) return
      e.preventDefault()
      void actions.ingest(readTransfer(e.clipboardData))
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [actions])
}

export function useShortcuts(actions: Actions) {
  const { visible } = useData()
  const overlay = useUi((s) => s.overlay)
  const inTrash = useUi((s) => s.view.type === "trash")
  const enabled = overlay === null
  const opts: Options = { enabled, preventDefault: true, ignoreEventWhen: insideOverlay }
  const ui = useUi.getState

  const moveCursor = (delta: number, extend: boolean) => {
    if (!visible.length) return
    const { cursor, anchor } = ui()
    const index = cursor ? visible.findIndex((c) => c.id === cursor) : -1
    const next = visible[index === -1 ? (delta > 0 ? 0 : visible.length - 1) : Math.max(0, Math.min(visible.length - 1, index + delta))]
    if (!next) return
    if (extend && anchor)
      ui().select(
        next.id,
        "range",
        visible.map((c) => c.id),
      )
    else ui().setSelection([next.id], next.id)
  }

  useHotkeys("mod+k", () => ui().setOverlay(overlay === "palette" ? null : "palette"), { preventDefault: true, enableOnFormTags: true })
  useHotkeys("slash", () => requestSearch(), opts)
  useHotkeys("shift+slash", () => ui().setOverlay("shortcuts"), opts)
  useHotkeys("n", () => ui().setOverlay("composer"), opts)

  useHotkeys(["j", "down"], () => moveCursor(1, false), opts, [visible])
  useHotkeys(["k", "up"], () => moveCursor(-1, false), opts, [visible])
  useHotkeys(["shift+j", "shift+down"], () => moveCursor(1, true), opts, [visible])
  useHotkeys(["shift+k", "shift+up"], () => moveCursor(-1, true), opts, [visible])
  useHotkeys("home", () => visible[0] && ui().setSelection([visible[0].id]), opts, [visible])
  useHotkeys("end", () => visible.at(-1) && ui().setSelection([visible.at(-1)!.id]), opts, [visible])
  useHotkeys(
    "mod+a",
    () =>
      ui().setSelection(
        visible.map((c) => c.id),
        visible[0]?.id ?? null,
      ),
    opts,
    [visible],
  )

  useHotkeys(
    "escape",
    () => {
      if (ui().queue) ui().setQueue(null)
      else if (ui().query) ui().setQuery("")
      else ui().clearSelection()
    },
    { ...opts, preventDefault: false },
  )

  useHotkeys(
    "enter",
    () => {
      if (ui().queue) return void actions.copyNextInQueue()
      if (inTrash) return
      void actions.copy()
    },
    opts,
    [actions, inTrash],
  )
  useHotkeys(
    "mod+c",
    (e) => {
      // Respect a normal text copy when something is highlighted.
      if (hasTextSelection()) return
      e.preventDefault()
      if (ui().queue) return void actions.copyNextInQueue()
      void actions.copy()
    },
    { ...opts, preventDefault: false },
    [actions],
  )
  useHotkeys("shift+enter", () => void actions.copy(undefined, "\n"), opts, [actions])
  useHotkeys("q", () => void actions.startQueue(), opts, [actions])

  useHotkeys("p", () => void actions.togglePin(), opts, [actions])
  useHotkeys("m", () => ui().selected.length && ui().setOverlay("move"), opts)
  useHotkeys("d", () => void actions.download(), opts, [actions])
  useHotkeys("e", () => requestEdit(), opts)
  useHotkeys(
    "r",
    () => {
      if (inTrash) void actions.restore()
      else requestRename()
    },
    opts,
    [actions, inTrash],
  )
  useHotkeys(["backspace", "delete"], () => void (inTrash ? actions.destroy() : actions.trash()), opts, [actions, inTrash])

  useHotkeys("alt+up", () => void actions.nudge("up"), opts, [actions])
  useHotkeys("alt+down", () => void actions.nudge("down"), opts, [actions])
  useHotkeys("alt+shift+up", () => void actions.nudge("top"), opts, [actions])
  useHotkeys("alt+shift+down", () => void actions.nudge("bottom"), opts, [actions])

  useHotkeys(["bracketleft", "mod+backslash"], () => ui().setSidebarOpen(!ui().sidebarOpen), opts)

  useHotkeys("g>a", () => ui().setView({ type: "all" }), opts)
  useHotkeys("g>p", () => ui().setView({ type: "pinned" }), opts)
  useHotkeys("g>t", () => ui().setView({ type: "trash" }), opts)
}
