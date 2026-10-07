import { useCallback, useEffect } from "react"
import { toast } from "sonner"
import type { ClipInput } from "@/db/actions"
import { readTransfer } from "@/lib/clipboard"
import type { Actions } from "@/state/actions"
import { useData } from "@/state/data"
import { insertIntoNote } from "@/state/notes"
import { useUi } from "@/state/ui"

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT"
}

/**
 * Where something pasted or dropped on the page (rather than into a field) goes: into this tab's note
 * while writing, otherwise into the library as new clips. A trashed note takes nothing.
 */
type PageTarget = "note" | "trashed-note" | "clips"

export function usePageInput(actions: Actions) {
  const { byId } = useData()

  const target = useCallback((): PageTarget => {
    const { view, note } = useUi.getState()
    if (view.type !== "write") return "clips"
    // A note too new to be in the data yet is about to be; it can't be in the trash.
    const clip = note ? byId.get(note) : undefined
    return clip && clip.deletedAt !== null ? "trashed-note" : "note"
  }, [byId])

  const deliver = useCallback(
    (inputs: ClipInput[]) => {
      if (!inputs.length) return
      const where = target()
      if (where === "note") insertIntoNote(inputs)
      else if (where === "clips") void actions.ingest(inputs)
      else toast("This note is in the trash", { description: "Restore it to add to it." })
    },
    [target, actions],
  )

  return { target, deliver }
}

/** ⌘V anywhere outside a text field. */
export function usePasteCapture(actions: Actions) {
  const { deliver } = usePageInput(actions)
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target) || !e.clipboardData) return
      if (useUi.getState().overlay !== null) return
      e.preventDefault()
      deliver(readTransfer(e.clipboardData))
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [deliver])
}
