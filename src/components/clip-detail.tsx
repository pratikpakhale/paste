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
  PencilLine,
  Pin,
  Trash2,
  X,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
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
import { clipDetail, clipLabel, clipSize, extensionStart, formatAgo, formatBytes, formatDate, kindLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { onEditRequest, onRenameRequest } from "@/lib/ui-events"
import { useData } from "@/state/data"
import { useUi } from "@/state/ui"
import { CodeView, ColorView, FileCard, ImageView, JsonView, LinkView, MarkdownView, MediaView, PdfView, TextEditor } from "./clip-body"
import { ClipThumb, SpaceDot } from "./clip-visual"

export function DetailPane() {
  const { byId } = useData()
  const selected = useUi((s) => s.selected)
  const cursor = useUi((s) => s.cursor)

  if (selected.length > 1) return <MultiDetail ids={selected} />
  const clip = cursor ? byId.get(cursor) : undefined
  if (!clip) return <EmptyDetail />
  return <ClipDetail key={clip.id} clip={clip} />
}

function IconAction({
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

/** A file clip's name is its file name; a text clip's is its title, with the derived label as placeholder. */
const storedName = (clip: Clip) => (isFileClip(clip) ? clip.file.name : clip.title)

/** Keyed by the stored name, so a rename that resolves differently (an extension kept) shows what was saved. */
function TitleInput({ clip }: { clip: Clip }) {
  const stored = storedName(clip)
  const isFile = isFileClip(clip)
  const [value, setValue] = useState(stored)
  const ref = useRef<HTMLInputElement>(null)

  useEffect(
    () =>
      onRenameRequest(() => {
        const input = ref.current
        if (!input) return
        input.focus()
        // Like Finder: select the name but not the extension.
        input.setSelectionRange(0, isFile ? extensionStart(input.value) : input.value.length)
      }),
    [isFile],
  )

  const save = () => {
    if (value.trim() !== stored) void renameClip(clip.id, value)
  }

  return (
    <input
      ref={ref}
      value={value}
      aria-label={isFile ? "File name" : "Title"}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          setValue(stored)
          requestAnimationFrame(() => ref.current?.blur())
        }
      }}
      placeholder={isFile ? "Name" : clipLabel({ ...clip, title: "" })}
      spellCheck={!isFile}
      className="min-w-0 flex-1 truncate bg-transparent text-title font-medium outline-none placeholder:text-foreground/80 focus:placeholder:text-subtle"
    />
  )
}

function ClipDetail({ clip }: { clip: Clip }) {
  const actions = useActions()
  const inTrash = clip.deletedAt !== null
  /** Preview vs. source for kinds that render differently from their text. */
  const [editing, setEditing] = useState(false)
  useEffect(() => onEditRequest(() => setEditing(true)), [])

  return (
    <div className="flex h-full min-w-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b pr-2.5 pl-5">
        <ClipThumb clip={clip} />
        <TitleInput key={storedName(clip)} clip={clip} />
        <div className="flex items-center">
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
              {!isDownloadOnly(clip) && (
                <Button size="sm" className="ml-1.5" onClick={() => void actions.copy([clip.id])}>
                  <Copy /> Copy
                  <Kbd className="-mr-1 bg-white/15 text-primary-foreground">↵</Kbd>
                </Button>
              )}
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

const TEXT_KIND_OPTIONS: TextKind[] = ["text", "markdown", "code", "json", "link", "color"]

interface ModeProps {
  editing: boolean
  onEditingChange: (editing: boolean) => void
}

function Toolbar({ clip, editing, onEditingChange }: { clip: Clip } & ModeProps) {
  const { spaces } = useData()
  const actions = useActions()
  const space = spaces.find((s) => s.id === clip.spaceId)

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b px-3.5">
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

      {!isFileClip(clip) && (
        <>
          <span className="h-3.5 w-px bg-border" />
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
        </>
      )}

      {!isFileClip(clip) && (clip.kind === "markdown" || clip.kind === "code" || clip.kind === "json") && (
        <ModeToggle editing={editing} onChange={onEditingChange} />
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

function ModeToggle({ editing, onChange }: { editing: boolean; onChange: (editing: boolean) => void }) {
  return (
    <div className="ml-auto flex items-center rounded-md bg-muted p-0.5">
      {[
        { value: false, label: "Preview", icon: Eye },
        { value: true, label: "Edit", icon: PencilLine },
      ].map(({ value, label, icon: Icon }) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(value)}
          className={cn(
            "flex h-5.5 items-center gap-1 rounded-[5px] px-2 text-caption transition-colors",
            editing === value ? "bg-background text-foreground shadow-xs dark:bg-accent" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-3" />
          {label}
        </button>
      ))}
    </div>
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
          <div className="px-6 py-8">
            <FileCard clip={clip} />
          </div>
        )
    }
  }

  const textClip = clip
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
    <footer className="flex h-9 shrink-0 items-center gap-4 overflow-hidden border-t px-5 text-caption whitespace-nowrap text-subtle">
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
  const inTrash = useUi((s) => s.view.type === "trash")
  const set = new Set(ids)
  const clips = [
    ...visible.filter((c) => set.has(c.id)),
    ...ids.filter((id) => !visible.some((c) => c.id === id)).flatMap((id) => byId.get(id) ?? []),
  ]

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
            <div className="flex flex-col gap-2">
              <BigAction
                primary
                icon={Copy}
                label="Copy all as one"
                hint="Text joined by blank lines; images embedded where the target supports rich paste."
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
            <div className="flex flex-wrap gap-1.5">
              <Button variant="outline" size="sm" onClick={() => void actions.togglePin(ids)}>
                <Pin /> {clips.every((c) => c.pinned) ? "Unpin" : "Pin"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => useUi.getState().setOverlay("move")}>
                <FolderInput /> Move…
              </Button>
              <Button variant="outline" size="sm" onClick={() => void actions.download(ids)}>
                <Download /> Download zip
              </Button>
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
    ["N", "Write a new clip"],
    ["J K", "Move through clips"],
    ["↵", "Copy selected"],
    ["⇧ click", "Select a range"],
    ["Q", "Copy a selection one by one"],
    ["⌥↑ ⌥↓", "Rearrange"],
    ["⌘K", "Search & commands"],
  ]
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <ClipboardPaste className="size-6 text-faint" strokeWidth={1.5} />
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
