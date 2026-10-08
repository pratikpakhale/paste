import {
  ArchiveRestore,
  Check,
  ChevronDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  Eye,
  FolderInput,
  ListOrdered,
  Maximize2,
  PencilLine,
  Pin,
  Trash2,
  X,
} from "lucide-react"
import { lazy, type ReactNode, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { renameClip, updateClip } from "@/db/actions"
import { type Clip, isFileClip, type TextClip, type TextKind } from "@/db/schema"
import { isDownloadOnly } from "@/lib/clipboard"
import { type LanguageOption, loadLanguages } from "@/lib/code"
import { clipDetail, clipLabel, clipSize, extensionStart, fileExtension, formatAgo, formatBytes, formatDate, kindLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { onEditRequest, onRenameRequest } from "@/lib/ui-events"
import { useData } from "@/state/data"
import { openNote } from "@/state/notes"
import { useUi } from "@/state/ui"
import { CodeView, ColorView, FileCard, ImageView, JsonView, LinkView, MarkdownView, MediaView, PdfView, TextEditor } from "./clip-body"
import { ClipThumb, SpaceDot } from "./clip-visual"
import { Segmented } from "./segmented"
import { useView } from "@/state/route"

/** The rich-text editor stays out of the first load; only notes need it. */
export const NoteEditor = lazy(() => import("./note-editor"))

export function DetailPane() {
  const { byId } = useData()
  const selected = useUi((s) => s.selected)
  const cursor = useUi((s) => s.cursor)

  if (selected.length > 1) return <MultiDetail ids={selected} />
  const clip = cursor ? byId.get(cursor) : undefined
  if (!clip) return <EmptyDetail />
  return <ClipDetail key={clip.id} clip={clip} />
}

export function IconAction({
  label,
  keys,
  onClick,
  children,
  active,
}: {
  label: string
  keys?: string
  onClick: () => void
  children: ReactNode
  active?: boolean
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={onClick}
          className={active ? "text-primary" : "text-muted-foreground"}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <Kbd>{keys}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/** A file clip's name is its file name; a text clip's is its title, where empty means derived from the content. */
const storedName = (clip: Clip) => (isFileClip(clip) ? clip.file.name : clip.title)

/**
 * The clip's name in the detail header. Reads as text with a hover affordance; a click, R or "Rename" swaps in
 * an input over the exact same box, so nothing moves. Files start with just the base name selected.
 */
export function NameField({ clip }: { clip: Clip }) {
  const isFile = isFileClip(clip)
  const stored = storedName(clip)
  /** `null` while not editing. */
  const [draft, setDraft] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)

  useEffect(() => onRenameRequest(() => setDraft(stored)), [stored])

  const editing = draft !== null
  useLayoutEffect(() => {
    const el = input.current
    if (!editing || !el) return
    el.focus()
    el.setSelectionRange(0, isFile ? extensionStart(el.value) : el.value.length)
  }, [editing, isFile])

  const commit = () => {
    if (draft === null) return
    setDraft(null)
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const next = draft.trim()
    // An emptied file name keeps the old one; an emptied title goes back to the derived label.
    if (next !== stored && (next || !isFile)) void renameClip(clip.id, next)
  }

  const box = "-ml-2 h-8 min-w-0 rounded-md px-2 text-title font-medium"

  if (editing) {
    return (
      <input
        ref={input}
        value={draft}
        aria-label={isFile ? "File name" : "Title"}
        spellCheck={!isFile}
        placeholder={isFile ? "Name" : clipLabel({ ...clip, title: "" })}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
          if (e.key === "Escape") {
            e.stopPropagation()
            cancelled.current = true
            e.currentTarget.blur()
          }
        }}
        className={cn(box, "w-full flex-1 bg-background ring-1 ring-ring outline-none placeholder:text-subtle")}
      />
    )
  }

  const split = isFile ? extensionStart(stored) : stored.length
  return (
    <div className="flex min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setDraft(stored)}
        className={cn(box, "group/name flex max-w-full cursor-text items-center gap-2 text-left transition-colors hover:bg-accent/70")}
      >
        {isFile ? (
          <span className="flex min-w-0">
            <span className="truncate">{stored.slice(0, split)}</span>
            <span className="shrink-0 text-subtle">{stored.slice(split)}</span>
          </span>
        ) : (
          <span className={cn("truncate", !clip.title && "text-foreground/80")}>{clipLabel(clip)}</span>
        )}
        <PencilLine className="size-3.5 shrink-0 text-subtle opacity-0 transition-opacity group-hover/name:opacity-100" />
      </button>
    </div>
  )
}

/** Shows a check when the clip is copied by any route (button, ↵, menu), at a fixed width so nothing shifts. */
export function CopyButton({ clip }: { clip: Clip }) {
  const actions = useActions()
  const [seen, setSeen] = useState(clip.copiedAt)
  const copied = clip.copiedAt !== seen
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setSeen(clip.copiedAt), 1400)
    return () => clearTimeout(timer)
  }, [copied, clip.copiedAt])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="sm" className="ml-1.5" onClick={() => void actions.copy([clip.id])}>
          {copied ? <Check key="check" className="animate-in duration-200 zoom-in-50" /> : <Copy key="copy" />}
          <span className="grid *:col-start-1 *:row-start-1">
            <span className={cn(copied && "invisible")}>Copy</span>
            <span className={cn(!copied && "invisible")}>Copied</span>
          </span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Copy
        <Kbd>↵</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

function ClipDetail({ clip }: { clip: Clip }) {
  const actions = useActions()
  const inTrash = clip.deletedAt !== null
  /** Preview vs. source for kinds that render differently from their text. */
  const [editing, setEditing] = useState(false)
  useEffect(() => onEditRequest(() => setEditing(true)), [])

  return (
    <div className="flex h-full min-w-0 animate-in flex-col duration-150 fade-in-50 motion-reduce:animate-none">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b pr-3 pl-5">
        <ClipThumb clip={clip} />
        <NameField clip={clip} />
        <div className="flex shrink-0 items-center gap-0.5">
          {inTrash ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => void actions.restore([clip.id])}>
                <ArchiveRestore /> Restore
              </Button>
              <IconAction label="Delete forever" onClick={() => void actions.destroy([clip.id])}>
                <X />
              </IconAction>
            </>
          ) : (
            <>
              <IconAction
                label={clip.pinned ? "Unpin" : "Pin"}
                keys="P"
                active={clip.pinned}
                onClick={() => void actions.togglePin([clip.id])}
              >
                <Pin className={cn(clip.pinned && "fill-current")} />
              </IconAction>
              <IconAction label="Download" keys="D" onClick={() => void actions.download([clip.id])}>
                <Download />
              </IconAction>
              <IconAction label="Move to trash" keys="⌫" onClick={() => void actions.trash([clip.id])}>
                <Trash2 />
              </IconAction>
              {!isDownloadOnly(clip) && <CopyButton clip={clip} />}
            </>
          )}
        </div>
      </header>

      {!inTrash && <Toolbar clip={clip} editing={editing} onEditingChange={setEditing} />}

      <div className="relative min-h-0 flex-1 scrollbar-thin overflow-y-auto">
        <Body clip={clip} editing={editing} />
      </div>

      <Meta clip={clip} />
    </div>
  )
}

/** Kinds a text clip can be switched between. A note's content is a document, not text, so it isn't one. */
const TEXT_KIND_OPTIONS: TextKind[] = ["text", "markdown", "code", "json", "link", "color"]

interface ModeProps {
  editing: boolean
  onEditingChange: (editing: boolean) => void
}

/** Which space the clip is in, and the menu to move it. */
export function SpacePicker({ clip }: { clip: Clip }) {
  const { spaces } = useData()
  const actions = useActions()
  const space = spaces.find((s) => s.id === clip.spaceId)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs" className="text-muted-foreground">
          {space ? <SpaceDot id={space.id} /> : <FolderInput />}
          {space?.name ?? "No space"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        {spaces.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => void actions.moveTo(s.id, [clip.id])}>
            <SpaceDot id={s.id} /> {s.name}
            {s.id === clip.spaceId && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
        {spaces.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onSelect={() => void actions.moveTo(null, [clip.id])}>
          No space
          {clip.spaceId === null && <Check className="ml-auto" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Toolbar({ clip, editing, onEditingChange }: { clip: Clip } & ModeProps) {
  const extension = isFileClip(clip) && fileExtension(clip.file.name)

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3">
      <SpacePicker clip={clip} />

      <span className="h-3.5 w-px bg-border" />
      {isFileClip(clip) || clip.kind === "note" ? (
        <>
          <span className="px-2 text-caption text-muted-foreground">
            {kindLabel(clip.kind)}
            {extension && <span className="text-subtle"> · {extension}</span>}
          </span>
          {clip.kind === "note" && (
            <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => openNote(clip.id)}>
              <Maximize2 /> Open in Write
            </Button>
          )}
        </>
      ) : (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="xs" className="text-muted-foreground">
                {kindLabel(clip.kind)}
                <ChevronDown className="opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-40">
              {TEXT_KIND_OPTIONS.map((kind) => (
                <DropdownMenuItem key={kind} onSelect={() => void updateClip(clip.id, { kind })}>
                  {kindLabel(kind)}
                  {kind === clip.kind && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {clip.kind === "code" && <LanguagePicker clip={clip} />}
          {(clip.kind === "markdown" || clip.kind === "code" || clip.kind === "json") && (
            <div className="ml-auto">
              <Segmented<"preview" | "edit">
                label="Mode"
                value={editing ? "edit" : "preview"}
                onChange={(mode) => onEditingChange(mode === "edit")}
                options={[
                  { value: "preview", label: "Preview", icon: Eye },
                  { value: "edit", label: "Edit", icon: PencilLine },
                ]}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function LanguagePicker({ clip }: { clip: TextClip }) {
  const [open, setOpen] = useState(false)
  const [languages, setLanguages] = useState<LanguageOption[]>([])

  useEffect(() => {
    if (open && !languages.length) void loadLanguages().then(setLanguages)
  }, [open, languages.length])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="font-mono text-caption text-muted-foreground">
          {clip.language ?? "plain"}
          <ChevronDown className="opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <Command>
          <CommandInput placeholder="Language…" />
          <CommandList>
            <CommandEmpty>No language</CommandEmpty>
            <CommandGroup>
              {languages.map((lang) => (
                <CommandItem
                  key={lang.id}
                  value={`${lang.name} ${lang.id}`}
                  onSelect={() => {
                    void updateClip(clip.id, { language: lang.id })
                    setOpen(false)
                  }}
                >
                  {lang.name}
                  {lang.id === clip.language && <Check className="ml-auto" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function Body({ clip, editing }: { clip: Clip; editing: boolean }) {
  if (isFileClip(clip)) {
    switch (clip.kind) {
      case "image":
        return <ImageView clip={clip} />
      case "video":
      case "audio":
        return <MediaView clip={clip} />
      case "pdf":
        return <PdfView clip={clip} />
      case "file":
        return (
          <div className="p-5">
            <FileCard clip={clip} />
          </div>
        )
    }
  }

  const textClip = clip
  if (textClip.kind === "note")
    return (
      <Suspense>
        <NoteEditor clip={textClip} readOnly={textClip.deletedAt !== null} />
      </Suspense>
    )
  const mono = textClip.kind === "code" || textClip.kind === "json"
  if (editing || textClip.kind === "text") return <TextEditor clip={textClip} mono={mono} autoFocus={editing} />

  switch (textClip.kind) {
    case "markdown":
      return <MarkdownView text={textClip.text} />
    case "code":
      return <CodeView code={textClip.text} language={textClip.language} />
    case "json":
      return <JsonView clip={textClip} />
    case "link":
      return <LinkView clip={textClip} />
    case "color":
      return <ColorView clip={textClip} />
  }
}

function Meta({ clip }: { clip: Clip }) {
  const items = [
    ["Added", formatDate(clip.createdAt)],
    clip.updatedAt - clip.createdAt > 1000 ? ["Edited", formatAgo(clip.updatedAt)] : null,
    clip.copiedAt ? ["Copied", formatAgo(clip.copiedAt)] : null,
    ["Size", isFileClip(clip) ? clipDetail(clip) : `${formatBytes(clipSize(clip))} · ${clipDetail(clip)}`],
  ].filter((item) => item !== null)

  return (
    <footer className="flex h-10 shrink-0 items-center gap-5 overflow-hidden border-t px-5 text-caption whitespace-nowrap text-subtle">
      {items.map(([label, value]) => (
        <span key={label}>
          {label} <span className="text-muted-foreground">{value}</span>
        </span>
      ))}
    </footer>
  )
}

function MultiDetail({ ids }: { ids: string[] }) {
  const { visible, byId } = useData()
  const actions = useActions()
  const inTrash = useView().type === "trash"
  const set = new Set(ids)
  const clips = [
    ...visible.filter((c) => set.has(c.id)),
    ...ids.filter((id) => !visible.some((c) => c.id === id)).flatMap((id) => byId.get(id) ?? []),
  ]
  const hasImages = clips.some((c) => c.kind === "image")

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-5">
        <span className="text-title font-medium">{clips.length} clips selected</span>
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => useUi.getState().clearSelection()}>
          Clear <Kbd>Esc</Kbd>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 scrollbar-thin flex-col gap-5 overflow-y-auto px-5 py-5">
        {inTrash ? (
          <div className="grid grid-cols-2 gap-2">
            <BigAction icon={ArchiveRestore} label="Restore" keys="R" onClick={() => void actions.restore(ids)} />
            <BigAction icon={X} label="Delete forever" keys="⌫" onClick={() => void actions.destroy(ids)} />
          </div>
        ) : (
          <>
            {hasImages ? (
              // The clipboard holds one image at a time, so only the queue carries every image everywhere.
              <div className="flex flex-col gap-2">
                <BigAction
                  primary
                  icon={ListOrdered}
                  label="Copy one by one"
                  hint="Each image goes on the clipboard as a real image. Paste, then ↵ for the next."
                  keys="Q"
                  onClick={() => void actions.startQueue(ids)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <BigAction
                    icon={Copy}
                    label="Copy all as one"
                    hint="Images only come through in rich-text apps like Docs or Notion."
                    keys="↵"
                    onClick={() => void actions.copy(ids)}
                  />
                  <BigAction
                    icon={Download}
                    label="Download zip"
                    hint="Every file, as it was pasted."
                    keys="D"
                    onClick={() => void actions.download(ids)}
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <BigAction
                  primary
                  icon={Copy}
                  label="Copy all as one"
                  hint="Text joined by blank lines."
                  keys="↵"
                  onClick={() => void actions.copy(ids)}
                />
                <div className="grid grid-cols-2 gap-2">
                  <BigAction
                    icon={ListOrdered}
                    label="Copy one by one"
                    hint="Copies #1, then ↵ for each next."
                    keys="Q"
                    onClick={() => void actions.startQueue(ids)}
                  />
                  <BigAction
                    icon={CopyPlus}
                    label="Join by line"
                    hint="Single newline between clips."
                    keys="⇧↵"
                    onClick={() => void actions.copy(ids, "\n")}
                  />
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => void actions.togglePin(ids)}>
                <Pin /> {clips.every((c) => c.pinned) ? "Unpin" : "Pin"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => useUi.getState().setOverlay("move")}>
                <FolderInput /> Move…
              </Button>
              {!hasImages && (
                <Button variant="outline" size="sm" onClick={() => void actions.download(ids)}>
                  <Download /> Download zip
                </Button>
              )}
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => void actions.trash(ids)}>
                <Trash2 /> Trash
              </Button>
            </div>
          </>
        )}

        <div className="flex flex-col">
          <span className="mb-1.5 text-caption font-medium text-subtle">{inTrash ? "Selected" : "Copy order"}</span>
          <ol className="flex flex-col overflow-hidden rounded-lg border">
            {clips.map((clip, i) => (
              <li key={clip.id} className="flex h-9 items-center gap-2.5 border-b px-3 last:border-b-0">
                <span className="w-4 text-right text-caption text-subtle tabular-nums">{i + 1}</span>
                <ClipThumb clip={clip} />
                <span className="min-w-0 flex-1 truncate">{clipLabel(clip)}</span>
                <span className="shrink-0 text-caption text-subtle">{kindLabel(clip.kind)}</span>
              </li>
            ))}
          </ol>
          {!inTrash && <p className="mt-2 text-caption text-subtle">Rearrange the list (⌥↑ ⌥↓ or drag) to change the order.</p>}
        </div>
      </div>
    </div>
  )
}

function BigAction({
  icon: Icon,
  label,
  hint,
  keys,
  onClick,
  primary,
}: {
  icon: typeof Copy
  label: string
  hint?: string
  keys: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        primary ? "border-primary/40 bg-primary/8 hover:bg-primary/12" : "hover:bg-accent",
      )}
    >
      <Icon className={cn("mt-px size-4 shrink-0", primary ? "text-primary" : "text-muted-foreground")} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-caption leading-snug text-subtle">{hint}</span>}
      </span>
      <Kbd>{keys}</Kbd>
    </button>
  )
}

function EmptyDetail() {
  const rows: [string, string][] = [
    ["⌘V", "Paste anything"],
    ["N", "Write a new note"],
    ["J K", "Move through clips"],
    ["↵", "Copy selected"],
    ["⌘ click", "Select several"],
    ["⇧ click", "Select a range"],
    ["⌘A", "Select all"],
    ["Q", "Copy a selection one by one"],
    ["⌥↑ ⌥↓", "Rearrange"],
    ["⌘K", "Search & commands"],
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <ClipboardPaste className="size-6 stroke-[1.5] text-faint" />
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-detail">
        {rows.map(([keys, label]) => (
          <div key={label} className="contents">
            <span className="flex justify-end gap-1">
              {keys.split(" ").map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </span>
            <span className="text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
