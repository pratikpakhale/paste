import { ArrowDownUp, LayoutGrid, List, Plus, Search, Trash2, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { onSearchRequest } from "@/lib/ui-events"
import { cn } from "@/lib/utils"
import { useActions } from "@/state/actions"
import { useData } from "@/state/data"
import { newNote } from "@/state/notes"
import { type Layout, type SortMode, useUi } from "@/state/ui"
import { SpaceDot } from "./clip-visual"
import { Segmented } from "./segmented"
import { viewTitle } from "./views"
import { useView } from "@/state/route"

const SORTS: { value: SortMode; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "copied", label: "Recently copied" },
]

export function ListHeader() {
  const { spaces, visible, counts } = useData()
  const actions = useActions()
  const view = useView()
  const sort = useUi((s) => s.sort)
  const layout = useUi((s) => s.layout)
  const query = useUi((s) => s.query)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const selected = useUi((s) => s.selected)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => onSearchRequest(() => search.current?.focus()), [])

  const inTrash = view.type === "trash"
  const selectedSet = new Set(selected)
  const allSelected = visible.length > 0 && visible.every((c) => selectedSet.has(c.id))
  const selecting = selected.length > 1

  // With the sidebar hidden, the fixed SidebarToggle sits over this header's left edge, so the title makes room.
  return (
    <header
      className={cn(
        "group/header flex h-12 shrink-0 items-center gap-3 border-b pr-3 transition-[padding] duration-200 ease-out motion-reduce:transition-none",
        sidebarOpen ? "pl-5" : "pl-13",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {visible.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Checkbox
                aria-label={allSelected ? "Clear selection" : "Select all"}
                checked={allSelected ? true : selecting ? "indeterminate" : false}
                onCheckedChange={() => {
                  const ui = useUi.getState()
                  if (allSelected) ui.clearSelection()
                  else
                    ui.setSelection(
                      visible.map((c) => c.id),
                      visible[0]?.id ?? null,
                    )
                }}
                className={cn(
                  "mr-1 cursor-pointer transition-opacity",
                  !selecting && "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100",
                )}
              />
            </TooltipTrigger>
            <TooltipContent>
              {allSelected ? (
                <>
                  Clear selection <Kbd>Esc</Kbd>
                </>
              ) : (
                <>
                  Select all <Kbd>⌘A</Kbd>
                </>
              )}
            </TooltipContent>
          </Tooltip>
        )}
        {view.type === "space" && <SpaceDot id={view.id} />}
        <h1 className="truncate font-medium">{viewTitle(view, spaces)}</h1>
        <span className={cn("whitespace-nowrap tabular-nums", selecting ? "text-primary" : "text-subtle")}>
          {selecting ? `${selected.length} of ${visible.length} selected` : visible.length}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <label className="group flex h-7 w-48 cursor-text items-center gap-2 rounded-md px-2 text-muted-foreground transition-colors focus-within:bg-accent hover:bg-accent/60">
          <Search className="size-4 shrink-0" />
          <input
            ref={search}
            value={query}
            onChange={(e) => useUi.getState().setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) useUi.getState().setQuery("")
                else e.currentTarget.blur()
              }
              if (e.key === "Enter" || e.key === "ArrowDown") {
                e.preventDefault()
                const first = useUi.getState().cursor ?? visible[0]?.id
                if (first) useUi.getState().setSelection([first], first)
                e.currentTarget.blur()
              }
            }}
            placeholder="Filter"
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-subtle"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => useUi.getState().setQuery("")}
              className="flex size-5 items-center justify-center rounded-sm text-subtle hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : (
            <Kbd className="opacity-0 transition-opacity group-hover:opacity-100">/</Kbd>
          )}
        </label>

        {inTrash ? (
          counts.trash > 0 && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void actions.clearTrash()}>
              <Trash2 /> Empty trash
            </Button>
          )
        ) : (
          <>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Sort"
                      className={sort === "manual" ? "text-muted-foreground" : "text-primary"}
                    >
                      <ArrowDownUp />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>Sort: {SORTS.find((s) => s.value === sort)?.label}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Order</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => useUi.getState().setSort(v as SortMode)}>
                  {SORTS.map((s) => (
                    <DropdownMenuRadioItem key={s.value} value={s.value}>
                      {s.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                {sort === "manual" && (
                  <p className="px-2 pt-1 pb-1.5 text-caption leading-snug text-subtle">
                    Drag to rearrange, or ⌥↑ ⌥↓. New pastes land on top.
                  </p>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <Segmented<Layout>
              label="Layout"
              iconOnly
              value={layout}
              onChange={(next) => useUi.getState().setLayout(next)}
              options={[
                { value: "list", label: "List view", icon: List },
                { value: "grid", label: "Grid view", icon: LayoutGrid },
              ]}
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New note"
                  className="text-muted-foreground"
                  onClick={() => void newNote()}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                New note <Kbd>N</Kbd>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  )
}
