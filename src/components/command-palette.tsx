import {
  ArrowDownUp,
  Calculator,
  ClipboardPlus,
  Coins,
  Copy,
  Download,
  FolderInput,
  FolderPlus,
  Inbox,
  Keyboard,
  LayoutGrid,
  List,
  ListOrdered,
  type LucideIcon,
  Monitor,
  NotebookPen,
  PanelLeft,
  PencilLine,
  Moon,
  Pin,
  Plus,
  Sun,
  Trash2,
  Upload,
} from "lucide-react"
import { useTheme } from "next-themes"
import { useMemo, useState } from "react"
import { toast } from "sonner"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { addClips, createSpace } from "@/db/actions"
import { useCalcAnswer } from "@/hooks/use-calc"
import { useDeferredFocus } from "@/hooks/use-deferred-focus"
import { clipLabel, kindLabel } from "@/lib/format"
import { useSearch } from "@/lib/search"
import { requestRename } from "@/lib/ui-events"
import { newSpace, useActions } from "@/state/actions"
import { isBlankNote } from "@/db/schema"
import { useData } from "@/state/data"
import { goWrite, newNote, openNote } from "@/state/notes"
import { useSettings } from "@/state/settings"
import { useUi } from "@/state/ui"
import { ClipThumb, SpaceDot } from "./clip-visual"
import { GROUPS } from "./views"
import { navigate, useNote, useView, type View } from "@/state/route"

interface Item {
  id: string
  label: string
  icon?: LucideIcon
  dot?: string
  keys?: string
  keywords?: string
  /** Moves focus into the page, so it runs once the dialog has handed focus back. */
  focuses?: boolean
  run: () => void
}

function matches(item: Item, words: string[]) {
  const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase()
  return words.every((w) => haystack.includes(w))
}

export function CommandPalette() {
  const overlay = useUi((s) => s.overlay)
  const open = overlay === "palette" || overlay === "move"
  const { defer, onCloseAutoFocus } = useDeferredFocus()
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => !next && useUi.getState().setOverlay(null)}
      title="Command palette"
      description="Search clips and run commands"
      className="top-[16%] sm:max-w-xl"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {/* Filtering is done here (full-text for clips), not by cmdk. */}
      <Command shouldFilter={false} loop>
        {open && (overlay === "move" ? <MoveCommands /> : <RootCommands defer={defer} />)}
      </Command>
    </CommandDialog>
  )
}

function close() {
  useUi.getState().setOverlay(null)
}

const ui = useUi.getState
const go = (view: View) => () => navigate({ view })

function RootCommands({ defer }: { defer: (run: () => void) => void }) {
  const [query, setQuery] = useState("")
  const { live, spaces, counts, visible, byId } = useData()
  const actions = useActions()
  const { setTheme } = useTheme()
  const listSelection = useUi((s) => s.selected)
  const writing = useView().type === "write"
  const noteId = useNote()
  // Write hides the list, so its selection is out of sight; commands act on the note being written instead.
  const note = writing && noteId ? byId.get(noteId) : undefined
  const selected = useMemo(
    () => (!writing ? listSelection : note && !isBlankNote(note) && note.deletedAt === null ? [note.id] : []),
    [writing, listSelection, note],
  )
  const hits = useSearch(live, query)
  const answer = useCalcAnswer(query)
  const currencyRates = useSettings((s) => s.currencyRates)
  const numberFormat = useSettings((s) => s.numberFormat)
  const autoAnswers = useSettings((s) => s.autoAnswers)

  const clipResults = useMemo(() => {
    if (!hits) return []
    return live.filter((c) => hits.has(c.id)).slice(0, 8)
  }, [hits, live])

  const groups = useMemo(() => {
    const hasSelection = selected.length > 0
    const many = selected.length > 1
    const clipActions: Item[] = hasSelection
      ? [
          {
            id: "copy",
            label: many ? `Copy ${selected.length} clips` : writing ? "Copy note" : "Copy",
            icon: Copy,
            keys: writing ? undefined : "↵",
            run: () => void actions.copy(selected),
          },
          ...(many
            ? [
                {
                  id: "queue",
                  label: "Copy one by one",
                  icon: ListOrdered,
                  keys: "Q",
                  keywords: "queue sequence",
                  run: () => void actions.startQueue(selected),
                },
              ]
            : []),
          ...(many
            ? []
            : [{ id: "rename", label: "Rename", icon: PencilLine, keys: "R", keywords: "title name", focuses: true, run: requestRename }]),
          { id: "pin", label: "Pin / unpin", icon: Pin, keys: writing ? undefined : "P", run: () => void actions.togglePin(selected) },
          {
            id: "move",
            label: "Move to space…",
            icon: FolderInput,
            keys: writing ? undefined : "M",
            run: () => {
              // The move dialog works on the selection.
              ui().setSelection(selected, selected[0] ?? null)
              ui().setOverlay("move")
            },
          },
          {
            id: "download",
            label: "Download",
            icon: Download,
            keys: writing ? undefined : "D",
            run: () => void actions.download(selected),
          },
          {
            id: "trash",
            label: "Move to trash",
            icon: Trash2,
            keys: writing ? undefined : "⌫",
            keywords: "delete remove",
            // Write moves on to a fresh note, as the trash button does.
            run: async () => {
              await actions.trash(selected)
              if (writing) await newNote()
            },
          },
        ]
      : []

    const general: Item[] = [
      { id: "new", label: "New note", icon: Plus, keys: "N", keywords: "write create clip scratch", run: () => void newNote() },
      {
        id: "new-space",
        label: "New space",
        icon: FolderPlus,
        keywords: "create folder collection",
        focuses: true,
        run: () => void newSpace(),
      },
      ...(writing
        ? []
        : [
            {
              id: "select-all",
              label: "Select all in view",
              icon: ListOrdered,
              keys: "⌘A",
              run: () => ui().setSelection(visible.map((c) => c.id)),
            },
          ]),
      {
        id: "sidebar",
        label: "Toggle sidebar",
        icon: PanelLeft,
        keys: "[",
        keywords: "hide show collapse",
        run: () => ui().setSidebarOpen(!ui().sidebarOpen),
      },
      { id: "layout-list", label: "View as list", icon: List, keywords: "layout", run: () => ui().setLayout("list") },
      { id: "layout-grid", label: "View as grid", icon: LayoutGrid, keywords: "layout gallery", run: () => ui().setLayout("grid") },
      { id: "sort-manual", label: "Sort manually", icon: ArrowDownUp, keywords: "order", run: () => ui().setSort("manual") },
      { id: "sort-newest", label: "Sort by newest", icon: ArrowDownUp, keywords: "order date", run: () => ui().setSort("newest") },
      { id: "sort-copied", label: "Sort by recently copied", icon: ArrowDownUp, keywords: "order used", run: () => ui().setSort("copied") },
      { id: "theme-light", label: "Light theme", icon: Sun, keywords: "appearance", run: () => setTheme("light") },
      { id: "theme-dark", label: "Dark theme", icon: Moon, keywords: "appearance", run: () => setTheme("dark") },
      { id: "theme-system", label: "System theme", icon: Monitor, keywords: "appearance auto", run: () => setTheme("system") },
      { id: "export", label: "Export backup", icon: Download, keywords: "zip save archive", run: () => void actions.exportAll() },
      { id: "import", label: "Import backup", icon: Upload, keywords: "zip restore archive", run: () => actions.importFrom() },
      {
        id: "shortcuts",
        label: "Keyboard shortcuts",
        icon: Keyboard,
        keys: "?",
        keywords: "help keys",
        run: () => ui().setOverlay("shortcuts"),
      },
      ...(counts.trash ? [{ id: "empty-trash", label: "Empty trash", icon: Trash2, run: () => void actions.clearTrash() }] : []),
      {
        id: "auto-answers",
        label: autoAnswers ? "Only answer lines that end in =" : "Answer every calculation in notes",
        icon: Calculator,
        keywords: "calculator math answers automatic equals notes",
        run: () => {
          useSettings.getState().setAutoAnswers(!autoAnswers)
          toast.success(autoAnswers ? "Only lines ending in = get an answer now" : "Every calculation in a note gets its answer")
        },
      },
      {
        id: "currency-rates",
        label: currencyRates ? "Stop fetching exchange rates" : "Fetch exchange rates for currency conversion",
        icon: Coins,
        keywords: "currency money ecb network offline convert calculator",
        run: () => {
          useSettings.getState().setCurrencyRates(!currencyRates)
          toast.success(currencyRates ? "Exchange rates off. Currencies won't convert" : "Exchange rates on, from the ECB, daily")
        },
      },
      ...(
        [
          ["indian", "Indian (1,00,000)"],
          ["international", "International (100,000)"],
          ["auto", "Match the browser's language"],
        ] as const
      )
        .filter(([format]) => format !== numberFormat)
        .map(([format, label]) => ({
          id: `number-format-${format}`,
          label: `Group numbers: ${label}`,
          icon: Calculator,
          keywords: "number format digits lakh crore thousands separator calculator",
          run: () => useSettings.getState().setNumberFormat(format),
        })),
    ]

    const navigation: Item[] = [
      { id: "go-write", label: "Write", icon: NotebookPen, keys: "W", keywords: "note scratch editor back", run: () => void goWrite() },
      { id: "go-all", label: "All clips", icon: Inbox, keys: "G A", run: go({ type: "all" }) },
      { id: "go-pinned", label: "Pinned", icon: Pin, keys: "G P", run: go({ type: "pinned" }) },
      ...GROUPS.filter((g) => counts.kinds[g.group] > 0).map((g) => ({
        id: `go-${g.group}`,
        label: g.label,
        icon: g.icon,
        run: go({ type: "kind", group: g.group }),
      })),
      ...spaces.map((s) => ({ id: `go-space-${s.id}`, label: s.name, dot: s.id, keywords: "space", run: go({ type: "space", id: s.id }) })),
      { id: "go-trash", label: "Trash", icon: Trash2, keys: "G T", run: go({ type: "trash" }) },
    ]

    return [
      { heading: writing ? "This note" : "Selection", items: clipActions },
      { heading: "Go to", items: navigation },
      { heading: "Commands", items: general },
    ]
  }, [actions, counts, selected, setTheme, spaces, visible, writing, currencyRates, numberFormat, autoAnswers])

  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const filtered = words.length ? groups.map(({ heading, items }) => ({ heading, items: items.filter((i) => matches(i, words)) })) : groups

  const reveal = (id: string) => {
    const clip = live.find((c) => c.id === id)
    if (!clip) return
    // Notes are for writing in, so they open where that happens.
    if (clip.kind === "note") return openNote(id)
    if (!visible.some((c) => c.id === id)) navigate({ view: clip.spaceId ? { type: "space", id: clip.spaceId } : { type: "all" } })
    useUi.getState().setSelection([id], id)
  }

  return (
    <>
      <CommandInput value={query} onValueChange={setQuery} placeholder="Search clips or type a command…" />
      <CommandList className="max-h-[min(420px,60vh)]">
        <CommandEmpty>Nothing found</CommandEmpty>
        {answer && <CalculatorResults query={query} answer={answer} />}
        {clipResults.length > 0 && (
          <CommandGroup heading="Clips">
            {clipResults.map((clip) => (
              <CommandItem
                key={clip.id}
                value={`clip-${clip.id}`}
                onSelect={() => {
                  close()
                  reveal(clip.id)
                }}
              >
                <ClipThumb clip={clip} />
                <span className="truncate">{clipLabel(clip)}</span>
                <CommandShortcut>{kindLabel(clip.kind)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {filtered.map(
          (group) =>
            group.items.length > 0 && (
              <CommandGroup key={group.heading} heading={group.heading}>
                {group.items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      if (item.id !== "move") close()
                      if (item.focuses) defer(item.run)
                      else item.run()
                    }}
                  >
                    {item.dot ? (
                      <span className="flex size-4 items-center justify-center">
                        <SpaceDot id={item.dot} />
                      </span>
                    ) : (
                      item.icon && <item.icon />
                    )}
                    {item.label}
                    {item.keys && <CommandShortcut>{item.keys}</CommandShortcut>}
                  </CommandItem>
                ))}
              </CommandGroup>
            ),
        )}
      </CommandList>
    </>
  )
}

function MoveCommands() {
  const [query, setQuery] = useState("")
  const { spaces } = useData()
  const actions = useActions()
  const count = useUi((s) => s.selected.length)
  const q = query.trim().toLowerCase()
  const matching = spaces.filter((s) => s.name.toLowerCase().includes(q))
  const exact = spaces.some((s) => s.name.toLowerCase() === q)

  const move = (spaceId: string | null) => {
    close()
    void actions.moveTo(spaceId)
  }

  return (
    <>
      <CommandInput value={query} onValueChange={setQuery} placeholder={`Move ${count === 1 ? "clip" : `${count} clips`} to…`} />
      <CommandList>
        <CommandGroup heading="Spaces">
          {matching.map((space) => (
            <CommandItem key={space.id} value={space.id} onSelect={() => move(space.id)}>
              <span className="flex size-4 items-center justify-center">
                <SpaceDot id={space.id} />
              </span>
              {space.name}
            </CommandItem>
          ))}
          {!q && (
            <CommandItem value="none" onSelect={() => move(null)}>
              <Inbox /> No space
            </CommandItem>
          )}
          {q && !exact && (
            <CommandItem value="create" onSelect={() => void createSpace(query).then(move)}>
              <FolderPlus /> Create “{query.trim()}”
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </>
  )
}

function copy(text: string) {
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${text}`),
    () => toast.error("Couldn't copy"),
  )
}

function CalculatorResults({ query, answer }: { query: string; answer: NonNullable<ReturnType<typeof useCalcAnswer>> }) {
  const view = useView()
  const shown = answer.display.replace(/^≈\s*/, "")
  return (
    <CommandGroup heading="Calculator">
      <CommandItem
        value="calc-copy"
        onSelect={() => {
          close()
          copy(shown)
        }}
        title={answer.interpretation}
      >
        <Calculator />
        <span className="truncate">
          <span className="text-subtle">=</span> <span className="font-medium tabular-nums">{answer.display}</span>
        </span>
        <CommandShortcut>Copy ↵</CommandShortcut>
      </CommandItem>
      {answer.approximate && (
        <CommandItem
          value="calc-copy-full"
          onSelect={() => {
            close()
            copy(answer.full)
          }}
        >
          <Copy />
          <span className="truncate">Copy every digit</span>
        </CommandItem>
      )}
      <CommandItem
        value="calc-save"
        onSelect={() => {
          close()
          void addClips([{ type: "text", text: shown }], view.type === "space" ? view.id : null).then(() =>
            toast.success(`Saved ${shown} as a clip`),
          )
        }}
      >
        <ClipboardPlus />
        <span className="truncate">Save answer as a clip</span>
        <CommandShortcut className="max-w-40 truncate">{query.trim()}</CommandShortcut>
      </CommandItem>
    </CommandGroup>
  )
}
