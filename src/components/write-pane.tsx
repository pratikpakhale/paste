import { ArchiveRestore, Check, NotebookPen, Plus, Trash2, Users } from "lucide-react"
import { useLiveQuery } from "dexie-react-hooks"
import { type MouseEvent, type ReactNode, Suspense, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { type Clip, db, isBlankNote, type TextClip } from "@/db/schema"
import { clipDetail, formatAgo } from "@/lib/format"
import { requestEdit } from "@/lib/ui-events"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { useData } from "@/state/data"
import { newNote, openNote, useOtherTabs, useSaving } from "@/state/notes"
import { useUi } from "@/state/ui"
import { CopyButton, IconAction, NameField, NoteEditor, SpacePicker } from "./clip-detail"

/** Write: this tab's note across the whole main area, with the clip list out of the way. */
export function WritePane() {
  const { ready, byId } = useData()
  const id = useUi((s) => s.note)
  const clip = id ? byId.get(id) : undefined

  if (!ready || !id) return <Frame />
  if (!clip || clip.kind !== "note") return <Gone id={id} />
  return <WriteNote key={clip.id} clip={clip} />
}

interface FrameProps {
  header?: ReactNode
  footer?: ReactNode
  children?: ReactNode
  onBodyMouseDown?: (event: MouseEvent<HTMLDivElement>) => void
}

function Frame({ header, footer, children, onBodyMouseDown }: FrameProps) {
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  // With the sidebar hidden, the fixed SidebarToggle sits over this header's left edge, so the title makes room.
  return (
    <div className="flex h-full min-w-0 flex-col">
      <header
        className={cn(
          "flex h-12 shrink-0 items-center gap-3 pr-3 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
          sidebarOpen ? "pl-5" : "pl-11",
        )}
      >
        {header}
      </header>
      {/* Clicking the page is a shortcut to the editor, which has its own keyboard access (E, ↵). */}
      <div role="presentation" className="relative min-h-0 flex-1 scrollbar-thin overflow-y-auto" onMouseDown={onBodyMouseDown}>
        {children}
      </div>
      {footer}
    </div>
  )
}

/** The note was deleted for good, most likely from another tab. */
function Gone({ id }: { id: string }) {
  // A note that was just created isn't in the shared clip query yet; only say it's gone once the database agrees.
  const gone = useLiveQuery(async () => !(await db.clips.get(id)), [id], false)
  if (!gone) return <Frame />
  return (
    <Frame>
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <NotebookPen className="size-6 stroke-[1.5] text-faint" />
        <p className="text-muted-foreground">This note was deleted.</p>
        <Button size="sm" onClick={() => void newNote()}>
          <Plus /> New note <Kbd>N</Kbd>
        </Button>
      </div>
    </Frame>
  )
}

function WriteNote({ clip }: { clip: TextClip }) {
  const { live } = useData()
  const actions = useActions()
  const others = useOtherTabs(clip.id)
  const saving = useSaving(clip.id)
  const inTrash = clip.deletedAt !== null
  const blank = isBlankNote(clip)

  /** The note ↑ continues on a blank page: the one most recently written in. */
  const previous = useMemo(
    () =>
      live.reduce<Clip | undefined>(
        (best, c) => (c.kind === "note" && c.id !== clip.id && (!best || c.updatedAt > best.updatedAt) ? c : best),
        undefined,
      ),
    [live, clip.id],
  )

  const header = (
    <>
      {blank ? <span className="min-w-0 flex-1 truncate font-medium text-subtle">New note</span> : <NameField clip={clip} />}
      <div className="flex shrink-0 items-center gap-0.5">
        {others > 0 && (
          <span
            className="mr-2 flex h-6 items-center gap-1.5 rounded-full border px-2 text-caption text-muted-foreground"
            title="Edits show up in every tab as you type"
          >
            <Users className="size-3" />
            Open in {others + 1} tabs
          </span>
        )}
        <SpacePicker clip={clip} />
        {!inTrash && !blank && (
          <>
            <IconAction label="Move to trash" onClick={() => void actions.trash([clip.id]).then(() => newNote())}>
              <Trash2 />
            </IconAction>
            <CopyButton clip={clip} />
          </>
        )}
      </div>
    </>
  )

  const footer = (
    <footer className="flex h-10 shrink-0 items-center gap-5 px-5 text-caption whitespace-nowrap text-subtle">
      {blank ? (
        <span>Saved as you type, in every tab this note is open in</span>
      ) : (
        <>
          <span>{clipDetail(clip)}</span>
          {!inTrash && (
            <span className="flex items-center gap-1" aria-live="polite">
              {saving ? (
                "Saving…"
              ) : (
                <>
                  <Check className="size-3" /> Saved
                </>
              )}
            </span>
          )}
          {clip.updatedAt - clip.createdAt > 1000 && (
            <span>
              Edited <span className="text-muted-foreground">{formatAgo(clip.updatedAt)}</span>
            </span>
          )}
        </>
      )}
    </footer>
  )

  /** A click on the page around the text puts the caret in it, nearest to where the click was. */
  const onBodyMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (inTrash || event.button !== 0) return
    const target = event.target as Element
    if (target.closest(".ProseMirror, button, a, input, [role='button']")) return
    event.preventDefault()
    requestEdit({ x: event.clientX, y: event.clientY })
  }

  return (
    <Frame header={header} footer={footer} onBodyMouseDown={onBodyMouseDown}>
      {inTrash && (
        <div className="sticky top-0 z-10 flex h-10 items-center gap-3 border-b bg-background/90 px-5 text-detail text-muted-foreground backdrop-blur">
          This note is in the trash.
          <Button variant="ghost" size="xs" onClick={() => void actions.restore([clip.id])}>
            <ArchiveRestore /> Restore
          </Button>
        </div>
      )}
      <Suspense>
        <NoteEditor
          clip={clip}
          page
          readOnly={inTrash}
          previous={previous}
          onContinue={previous ? () => openNote(previous.id) : undefined}
        />
      </Suspense>
    </Frame>
  )
}
