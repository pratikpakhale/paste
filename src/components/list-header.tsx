import { ArrowDownUp, LayoutGrid, List, PanelLeft, Plus, Search, Trash2, X } from "lucide-react"
import { useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { onSearchRequest } from "@/lib/ui-events"
import { useActions } from "@/state/actions"
import { useData } from "@/state/data"
import { type Layout, type SortMode, useUi } from "@/state/ui"
import { SpaceDot } from "./clip-visual"
import { viewTitle } from "./views"

const SORTS: { value: SortMode; label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "copied", label: "Recently copied" },
]

export function ListHeader() {
  const { spaces, visible, counts } = useData()
  const actions = useActions()
  const view = useUi((s) => s.view)
  const sort = useUi((s) => s.sort)
  const layout = useUi((s) => s.layout)
  const query = useUi((s) => s.query)
  const sidebarOpen = useUi((s) => s.sidebarOpen)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => onSearchRequest(() => search.current?.focus()), [])

  const inTrash = view.type === "trash"

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b pr-2.5 pl-2.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={() => useUi.getState().setSidebarOpen(!sidebarOpen)}
            className="text-muted-foreground"
          >
            <PanelLeft />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {sidebarOpen ? "Hide sidebar" : "Show sidebar"}
          <Kbd>[</Kbd>
        </TooltipContent>
      </Tooltip>
      <div className="flex min-w-0 items-center gap-2">
        {view.type === "space" && <SpaceDot id={view.id} />}
        <h1 className="truncate font-medium">{viewTitle(view, spaces)}</h1>
        <span className="text-subtle tabular-nums">{visible.length}</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <label className="group flex h-7 w-44 items-center gap-1.5 rounded-md px-2 text-muted-foreground transition-[width,background-color] focus-within:w-60 focus-within:bg-accent hover:bg-accent/60">
          <Search className="size-3.5 shrink-0" />
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
              className="text-subtle hover:text-foreground"
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

            <ToggleGroup
              type="single"
              size="sm"
              value={layout}
              onValueChange={(v) => v && useUi.getState().setLayout(v as Layout)}
              className="text-muted-foreground"
            >
              <ToggleGroupItem value="list" aria-label="List view" className="size-7 px-0">
                <List />
              </ToggleGroupItem>
              <ToggleGroupItem value="grid" aria-label="Grid view" className="size-7 px-0">
                <LayoutGrid />
              </ToggleGroupItem>
            </ToggleGroup>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="New clip"
                  className="text-muted-foreground"
                  onClick={() => useUi.getState().setOverlay("composer")}
                >
                  <Plus />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                New clip <Kbd>N</Kbd>
              </TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </header>
  )
}
