import { ArchiveRestore, Copy, CopyPlus, Download, FolderInput, ListOrdered, PencilLine, Pin, PinOff, Trash2, X } from "lucide-react"
import type { ReactNode } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { useDeferredFocus } from "@/hooks/use-deferred-focus"
import { requestRename } from "@/lib/ui-events"
import { useActions } from "@/state/actions"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"
import { SpaceDot } from "./clip-visual"

/**
 * Right-click menu for clips. Acts on the whole selection when the clicked clip is part of it.
 * The trigger holds no subscriptions so list rows stay cheap; the content mounts only while open.
 */
export function ClipMenu({ clipId, onOpen, children }: { clipId: string; onOpen: (id: string) => void; children: ReactNode }) {
  const { defer, onCloseAutoFocus } = useDeferredFocus()
  return (
    <ContextMenu onOpenChange={(open) => open && onOpen(clipId)}>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56" onCloseAutoFocus={onCloseAutoFocus}>
        <ClipMenuItems clipId={clipId} defer={defer} />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function ClipMenuItems({ clipId, defer }: { clipId: string; defer: (run: () => void) => void }) {
  const actions = useActions()
  const { spaces, byId } = useData()
  const selected = useUi((s) => s.selected)
  const inTrash = useUi((s) => s.view.type === "trash")
  const ids = selected.includes(clipId) ? selected : [clipId]
  const many = ids.length > 1
  const allPinned = ids.every((id) => byId.get(id)?.pinned)
  const suffix = many ? ` ${ids.length} clips` : ""

  if (inTrash) {
    return (
      <>
        <ContextMenuItem onSelect={() => void actions.restore(ids)}>
          <ArchiveRestore /> Restore{suffix}
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={() => void actions.destroy(ids)}>
          <X /> Delete forever
          <ContextMenuShortcut>⌫</ContextMenuShortcut>
        </ContextMenuItem>
      </>
    )
  }

  return (
    <>
      <ContextMenuItem onSelect={() => void actions.copy(ids)}>
        <Copy /> {many ? `Copy all ${ids.length}` : "Copy"}
        <ContextMenuShortcut>↵</ContextMenuShortcut>
      </ContextMenuItem>
      {many && (
        <>
          <ContextMenuItem onSelect={() => void actions.copy(ids, "\n")}>
            <CopyPlus /> Copy joined by line
            <ContextMenuShortcut>⇧↵</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => void actions.startQueue(ids)}>
            <ListOrdered /> Copy one by one
            <ContextMenuShortcut>Q</ContextMenuShortcut>
          </ContextMenuItem>
        </>
      )}
      <ContextMenuSeparator />
      {!many && (
        <ContextMenuItem onSelect={() => defer(requestRename)}>
          <PencilLine /> Rename
          <ContextMenuShortcut>R</ContextMenuShortcut>
        </ContextMenuItem>
      )}
      <ContextMenuItem onSelect={() => void actions.togglePin(ids)}>
        {allPinned ? <PinOff /> : <Pin />} {allPinned ? "Unpin" : "Pin"}
        <ContextMenuShortcut>P</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <FolderInput /> Move to
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="w-48">
          {spaces.map((space) => (
            <ContextMenuItem key={space.id} onSelect={() => void actions.moveTo(space.id, ids)}>
              <SpaceDot id={space.id} /> {space.name}
            </ContextMenuItem>
          ))}
          {spaces.length > 0 && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={() => void actions.moveTo(null, ids)}>No space</ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => void actions.download(ids)}>
        <Download /> Download{suffix}
        <ContextMenuShortcut>D</ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => void actions.trash(ids)}>
        <Trash2 /> Move to trash
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </>
  )
}
