import { useMemo } from "react"
import { toast } from "sonner"
import {
  addClips,
  applyMove,
  type ClipInput,
  createSpace,
  deleteForever,
  emptyTrash,
  markCopied,
  moveToSpace,
  restoreClips,
  setPinned,
  trashClips,
} from "@/db/actions"
import type { Clip } from "@/db/schema"
import { exportArchive, importArchive } from "@/lib/archive"
import { copyClips, downloadBlob, downloadClips } from "@/lib/clipboard"
import { clipLabel } from "@/lib/format"
import { planMove } from "@/lib/order"
import { confirm } from "./confirm"
import { useData } from "./data"
import { useUi } from "./ui"

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** Creates a space, opens it and starts renaming it. */
export async function newSpace() {
  const id = await createSpace("New space")
  const ui = useUi.getState()
  // The name is edited inline in the sidebar, so it has to be showing.
  ui.setSidebarOpen(true)
  ui.setView({ type: "space", id })
  ui.setRenamingSpace(id)
}

function reportError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Something went wrong")
}

export type Actions = ReturnType<typeof useActions>

export function useActions() {
  const data = useData()

  return useMemo(() => {
    const { visible, live, byId } = data
    const ui = useUi.getState

    /** Ids the action applies to: explicit ones, else the selection, in on-screen order. */
    const resolve = (ids?: string[]): Clip[] => {
      const wanted = new Set(ids ?? ui().selected)
      const onScreen = visible.filter((c) => wanted.has(c.id))
      // Clips can be targeted while off-screen (e.g. from the palette); keep those too.
      const rest = [...wanted].filter((id) => !onScreen.some((c) => c.id === id)).flatMap((id) => byId.get(id) ?? [])
      return [...onScreen, ...rest]
    }

    async function copy(ids?: string[], separator?: string) {
      const clips = resolve(ids)
      if (!clips.length) return
      try {
        const outcome = await copyClips(clips, separator)
        if (outcome === "download") {
          await downloadClips(clips)
          toast("Downloaded", { description: "Browsers can't put files on the clipboard." })
        } else {
          toast.success(clips.length === 1 ? "Copied" : `Copied ${plural(clips.length, "clip")}`)
        }
        await markCopied(clips.map((c) => c.id))
      } catch (error) {
        reportError(error)
      }
    }

    /** Copies the queue's next clip and advances; the queue ends after the last one. */
    async function copyNextInQueue() {
      const queue = ui().queue
      if (!queue) return
      const id = queue.ids[queue.index]
      if (!id) return ui().setQueue(null)
      ui().setSelection([id], id)
      const next = queue.index + 1
      ui().setQueue(next < queue.ids.length ? { ...queue, index: next } : null)
      const clip = byId.get(id)
      if (!clip) return
      try {
        const outcome = await copyClips([clip])
        if (outcome === "download") await downloadClips([clip])
        await markCopied([id])
        if (next >= queue.ids.length) toast.success(`All ${plural(queue.ids.length, "clip")} copied`)
      } catch (error) {
        reportError(error)
      }
    }

    function startQueue(ids?: string[]) {
      const clips = resolve(ids)
      if (clips.length < 2) return copy(ids)
      ui().setQueue({ ids: clips.map((c) => c.id), index: 0 })
      return copyNextInQueue()
    }

    async function togglePin(ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      const pinned = !clips.every((c) => c.pinned)
      await setPinned(
        clips.map((c) => c.id),
        pinned,
      )
    }

    /** Moves the cursor off the clips about to leave the view, so the selection doesn't vanish. */
    function selectAfterRemoval(removed: Set<string>) {
      const index = visible.findIndex((c) => removed.has(c.id))
      const next = visible.slice(index).find((c) => !removed.has(c.id)) ?? visible.findLast((c) => !removed.has(c.id))
      if (next) ui().setSelection([next.id], next.id)
      else ui().clearSelection()
    }

    async function trash(ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      const removed = clips.map((c) => c.id)
      selectAfterRemoval(new Set(removed))
      await trashClips(removed)
      toast(clips.length === 1 ? `Moved “${clipLabel(clips[0]!)}” to trash` : `Moved ${plural(clips.length, "clip")} to trash`, {
        action: { label: "Undo", onClick: () => void restoreClips(removed) },
      })
    }

    async function restore(ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      selectAfterRemoval(new Set(clips.map((c) => c.id)))
      await restoreClips(clips.map((c) => c.id))
      toast.success(`Restored ${plural(clips.length, "clip")}`)
    }

    async function destroy(ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      const ok = await confirm({
        title: `Delete ${plural(clips.length, "clip")} forever?`,
        description: "This can't be undone.",
        action: "Delete",
      })
      if (!ok) return
      selectAfterRemoval(new Set(clips.map((c) => c.id)))
      await deleteForever(clips.map((c) => c.id))
    }

    async function clearTrash() {
      const ok = await confirm({
        title: "Empty trash?",
        description: `${plural(data.trashed.length, "clip")} will be deleted forever.`,
        action: "Empty trash",
      })
      if (!ok) return
      ui().clearSelection()
      await emptyTrash()
    }

    async function moveTo(spaceId: string | null, ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      const view = ui().view
      if (view.type === "space" && view.id !== spaceId) selectAfterRemoval(new Set(clips.map((c) => c.id)))
      await moveToSpace(
        clips.map((c) => c.id),
        spaceId,
      )
      const space = data.spaces.find((s) => s.id === spaceId)
      toast.success(space ? `Moved to ${space.name}` : "Removed from space")
    }

    /** Moves the given clips so they sit at `targetIndex` of the visible list without them. */
    async function moveToIndex(ids: string[], targetIndex: number) {
      if (!data.canReorder) return
      await applyMove(planMove(visible, live, ids, targetIndex))
    }

    /** Keyboard reordering of the selection: one step, or all the way to an end. */
    async function nudge(direction: "up" | "down" | "top" | "bottom") {
      const ids = new Set(ui().selected)
      if (!ids.size) return
      if (!data.canReorder) {
        toast("Switch to manual order to rearrange", { description: "Clear the search and set sort to Manual." })
        return
      }
      const rest = visible.filter((c) => !ids.has(c.id))
      const firstIndex = visible.findIndex((c) => ids.has(c.id))
      const lastIndex = visible.findLastIndex((c) => ids.has(c.id))
      const pinned = visible[firstIndex]?.pinned ?? false
      // Insertion points in `rest` just before and just after the selected block.
      const before = visible.slice(0, firstIndex).filter((c) => !ids.has(c.id)).length
      const after = visible.slice(0, lastIndex + 1).filter((c) => !ids.has(c.id)).length
      // Keyboard moves stay inside the pinned or unpinned group; pinning is its own action.
      const groupStart = rest.findIndex((c) => c.pinned === pinned)
      const groupEnd = rest.findLastIndex((c) => c.pinned === pinned) + 1
      const start = groupStart === -1 ? (pinned ? 0 : rest.length) : groupStart
      const end = groupStart === -1 ? start : groupEnd

      const target = { up: before - 1, down: after + 1, top: start, bottom: end }[direction]
      if (target < start || target > end) return
      await moveToIndex([...ids], target)
    }

    async function download(ids?: string[]) {
      const clips = resolve(ids)
      if (!clips.length) return
      try {
        await downloadClips(clips)
      } catch (error) {
        reportError(error)
      }
    }

    async function ingest(inputs: ClipInput[]) {
      if (!inputs.length) return
      const view = ui().view
      const spaceId = view.type === "space" ? view.id : null
      try {
        const ids = await addClips(inputs, spaceId)
        if (!ids.length) return
        // Make sure what was just pasted is on screen.
        if (view.type !== "space" && view.type !== "all") ui().setView({ type: "all" })
        ui().setQuery("")
        ui().setSelection(ids, ids[0])
      } catch (error) {
        reportError(error)
      }
    }

    async function exportAll() {
      const id = toast.loading("Preparing export…")
      try {
        const blob = await exportArchive()
        downloadBlob(blob, `paste-backup-${new Date().toISOString().slice(0, 10)}.zip`)
        toast.success("Backup exported", { id })
      } catch (error) {
        toast.dismiss(id)
        reportError(error)
      }
    }

    function importFrom() {
      const input = document.createElement("input")
      input.type = "file"
      input.accept = ".zip,application/zip"
      input.addEventListener("change", async () => {
        const file = input.files?.[0]
        if (!file) return
        const id = toast.loading("Importing…")
        try {
          const result = await importArchive(file)
          toast.success(`Imported ${plural(result.clips, "clip")} and ${plural(result.spaces, "space")}`, { id })
        } catch (error) {
          toast.dismiss(id)
          reportError(error)
        }
      })
      input.click()
    }

    return {
      copy,
      startQueue,
      copyNextInQueue,
      togglePin,
      trash,
      restore,
      destroy,
      clearTrash,
      moveTo,
      moveToIndex,
      nudge,
      download,
      ingest,
      exportAll,
      importFrom,
    }
  }, [data])
}
