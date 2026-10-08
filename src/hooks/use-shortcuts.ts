import { type Options, useHotkeys } from "react-hotkeys-hook"
import { requestEdit, requestRename, requestSearch } from "@/lib/ui-events"
import type { Actions } from "@/state/actions"
import { useData } from "@/state/data"
import { goWrite, newNote } from "@/state/notes"
import { useUi } from "@/state/ui"
import { navigate, useView } from "@/state/route"

/** Menus and dialogs own their keyboard; global shortcuts must not fire underneath them. */
function insideOverlay(e: KeyboardEvent): boolean {
  return e.target instanceof Element && e.target.closest('[role="menu"],[role="dialog"],[role="alertdialog"]') !== null
}

function hasTextSelection(): boolean {
  return Boolean(window.getSelection()?.toString())
}

export function useShortcuts(actions: Actions) {
  const { visible } = useData()
  const overlay = useUi((s) => s.overlay)
  const inTrash = useView().type === "trash"
  const writing = useView().type === "write"
  const enabled = overlay === null
  const opts: Options = { enabled, preventDefault: true, ignoreEventWhen: insideOverlay }
  /** Keys that act on the list's selection. Write hides the list, so they'd act on clips nobody can see. */
  const list: Options = { ...opts, enabled: enabled && !writing }
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

  useHotkeys("mod+k", () => ui().setOverlay(overlay === "palette" ? null : "palette"), {
    preventDefault: true,
    enableOnFormTags: true,
    enableOnContentEditable: true,
  })
  // Write has no filter box; search everything instead.
  useHotkeys("slash", () => (writing ? ui().setOverlay("palette") : requestSearch()), opts, [writing])
  useHotkeys("enter", () => requestEdit(), { ...opts, enabled: enabled && writing })
  useHotkeys("shift+slash", () => ui().setOverlay("shortcuts"), opts)
  useHotkeys("n", () => void newNote(), opts)
  useHotkeys("w", () => void goWrite(), opts)

  useHotkeys(["j", "down"], () => moveCursor(1, false), list, [visible])
  useHotkeys(["k", "up"], () => moveCursor(-1, false), list, [visible])
  useHotkeys(["shift+j", "shift+down"], () => moveCursor(1, true), list, [visible])
  useHotkeys(["shift+k", "shift+up"], () => moveCursor(-1, true), list, [visible])
  useHotkeys("home", () => visible[0] && ui().setSelection([visible[0].id]), list, [visible])
  useHotkeys("end", () => visible.at(-1) && ui().setSelection([visible.at(-1)!.id]), list, [visible])
  useHotkeys(
    "mod+a",
    () =>
      ui().setSelection(
        visible.map((c) => c.id),
        visible[0]?.id ?? null,
      ),
    list,
    [visible],
  )

  useHotkeys(
    "escape",
    () => {
      if (ui().queue) ui().setQueue(null)
      else if (ui().query) ui().setQuery("")
      else ui().clearSelection()
    },
    { ...list, preventDefault: false },
  )

  useHotkeys(
    "enter",
    () => {
      if (ui().queue) return void actions.copyNextInQueue()
      if (inTrash) return
      void actions.copy()
    },
    list,
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
    { ...list, preventDefault: false },
    [actions],
  )
  useHotkeys("shift+enter", () => void actions.copy(undefined, "\n"), list, [actions])
  useHotkeys("q", () => void actions.startQueue(), list, [actions])

  useHotkeys("p", () => void actions.togglePin(), list, [actions])
  useHotkeys("m", () => ui().selected.length && ui().setOverlay("move"), list)
  useHotkeys("d", () => void actions.download(), list, [actions])
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
  useHotkeys(["backspace", "delete"], () => void (inTrash ? actions.destroy() : actions.trash()), list, [actions, inTrash])

  useHotkeys("alt+up", () => void actions.nudge("up"), list, [actions])
  useHotkeys("alt+down", () => void actions.nudge("down"), list, [actions])
  useHotkeys("alt+shift+up", () => void actions.nudge("top"), list, [actions])
  useHotkeys("alt+shift+down", () => void actions.nudge("bottom"), list, [actions])

  useHotkeys(["bracketleft", "mod+backslash"], () => ui().setSidebarOpen(!ui().sidebarOpen), opts)

  useHotkeys("g>a", () => navigate({ view: { type: "all" } }), opts)
  useHotkeys("g>p", () => navigate({ view: { type: "pinned" } }), opts)
  useHotkeys("g>t", () => navigate({ view: { type: "trash" } }), opts)
}
