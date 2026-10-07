import { useDndContext, useDroppable } from "@dnd-kit/core"
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  Download,
  Ellipsis,
  Inbox,
  Keyboard,
  type LucideIcon,
  Monitor,
  Moon,
  PanelLeft,
  Pin,
  Plus,
  Search,
  Sun,
  Trash2,
  Upload,
} from "lucide-react"
import { useTheme } from "next-themes"
import { type ReactNode, useState } from "react"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { deleteSpace, renameSpace } from "@/db/actions"
import type { Space } from "@/db/schema"
import { useDeferredFocus } from "@/hooks/use-deferred-focus"
import { useStorage } from "@/hooks/use-storage"
import { formatBytes } from "@/lib/format"
import { cn } from "@/lib/utils"
import { newSpace, useActions } from "@/state/actions"
import { confirm } from "@/state/confirm"
import { useData } from "@/state/data"
import { useUi, type View } from "@/state/ui"
import { SpaceDot } from "./clip-visual"
import type { DropTarget } from "./drag-layer"
import { GROUPS, sameView } from "./views"

const go = (next: View) => useUi.getState().setView(next)

export function Sidebar() {
  const { counts, spaces, live } = useData()
  const view = useUi((s) => s.view)
  const { active } = useDndContext()
  const draggingClip = active?.data.current?.type === "clip"
  const open = useUi((s) => s.sidebarOpen)

  // The outer box animates its width while the sidebar keeps its own, so content slides out instead of reflowing.
  return (
    <div
      inert={!open}
      className={cn(
        "h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
        open ? "w-60" : "w-0",
      )}
    >
      <aside
        className={cn(
          "flex h-full w-60 flex-col px-3 pt-[calc(0.5rem+1px)] pb-3 transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
          !open && "-translate-x-4 opacity-0",
        )}
      >
        {/* Lines up with the list header; the left gap is where the fixed SidebarToggle sits. */}
        <div className="flex h-12 shrink-0 items-center gap-2 pl-9">
          <Logo />
          <span className="font-medium tracking-tight text-sidebar-accent-foreground">Paste</span>
        </div>

        <button
          type="button"
          onClick={() => useUi.getState().setOverlay("palette")}
          className="mt-1 flex h-8 shrink-0 items-center gap-2 rounded-md border bg-background/60 pr-1.5 pl-2.5 text-muted-foreground shadow-xs transition-colors hover:bg-background hover:text-foreground dark:bg-white/[0.03] dark:hover:bg-white/[0.05]"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Search…</span>
          <Kbd>⌘K</Kbd>
        </button>

        <nav className="mt-5 -mr-3 flex min-h-0 flex-1 scrollbar-thin flex-col gap-5 overflow-y-auto pr-3">
          <div className="flex flex-col gap-px">
            <NavItem
              icon={Inbox}
              label="All clips"
              count={counts.all}
              active={sameView(view, { type: "all" })}
              onClick={() => go({ type: "all" })}
              drop={draggingClip ? { type: "target", action: "unspace" } : undefined}
            />
            <NavItem
              icon={Pin}
              label="Pinned"
              count={counts.pinned}
              active={sameView(view, { type: "pinned" })}
              onClick={() => go({ type: "pinned" })}
              drop={draggingClip ? { type: "target", action: "pin" } : undefined}
            />
          </div>

          {GROUPS.some((g) => counts.kinds[g.group] > 0) && (
            <Section title="Types">
              {GROUPS.filter((g) => counts.kinds[g.group] > 0).map(({ group, label, icon }) => (
                <NavItem
                  key={group}
                  icon={icon}
                  label={label}
                  count={counts.kinds[group]}
                  active={sameView(view, { type: "kind", group })}
                  onClick={() => go({ type: "kind", group })}
                />
              ))}
            </Section>
          )}

          <Section
            title="Spaces"
            action={
              <button
                type="button"
                aria-label="New space"
                onClick={() => void newSpace()}
                className="flex size-5 items-center justify-center rounded text-subtle opacity-0 transition-opacity group-hover/section:opacity-100 hover:bg-sidebar-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            }
          >
            <SortableContext items={spaces.map((s) => `space:${s.id}`)} strategy={verticalListSortingStrategy}>
              {spaces.map((space) => (
                <SpaceItem
                  key={space.id}
                  space={space}
                  count={counts.spaces[space.id] ?? 0}
                  active={sameView(view, { type: "space", id: space.id })}
                />
              ))}
            </SortableContext>
            {spaces.length === 0 && (
              <button
                type="button"
                onClick={() => void newSpace()}
                className="flex h-8 items-center gap-2.5 rounded-md px-2.5 text-subtle transition-colors duration-75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <Plus className="size-4" /> New space
              </button>
            )}
          </Section>
        </nav>

        <div className="flex flex-col gap-3 pt-3">
          <NavItem
            icon={Trash2}
            label="Trash"
            count={counts.trash}
            active={view.type === "trash"}
            onClick={() => go({ type: "trash" })}
            drop={draggingClip ? { type: "target", action: "trash" } : undefined}
          />
          <Footer revision={live.length + counts.trash} />
        </div>
      </aside>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="group/section flex flex-col gap-px">
      <div className="flex h-7 items-center justify-between pr-1 pl-2.5 text-caption font-medium text-subtle">
        {title}
        {action}
      </div>
      {children}
    </div>
  )
}

interface NavItemProps {
  icon: LucideIcon
  label: string
  count: number
  active: boolean
  onClick: () => void
  drop?: DropTarget
}

function NavItem({ icon: Icon, label, count, active, onClick, drop }: NavItemProps) {
  const { setNodeRef, isOver } = useDroppable({ id: `nav:${label}`, data: drop, disabled: !drop })
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left transition-colors duration-75",
        active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        isOver && "bg-primary/15 text-foreground ring-1 ring-primary/40",
      )}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-sidebar-accent-foreground" : "text-subtle")} />
      <span className="flex-1 truncate">{label}</span>
      {count > 0 && <span className="text-caption text-subtle tabular-nums">{count}</span>}
    </button>
  )
}

function SpaceItem({ space, count, active }: { space: Space; count: number; active: boolean }) {
  const renaming = useUi((s) => s.renamingSpace === space.id)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
    active: dragActive,
  } = useSortable({
    id: `space:${space.id}`,
    data: { type: "space", spaceId: space.id } satisfies DropTarget,
    disabled: renaming,
  })
  const clipOver = isOver && dragActive?.data.current?.type === "clip"
  const { defer, onCloseAutoFocus } = useDeferredFocus()

  const remove = async () => {
    const ok = await confirm({
      title: `Delete “${space.name}”?`,
      description: count ? `Its ${count} clip${count === 1 ? "" : "s"} stay in All clips.` : "The space is empty.",
      action: "Delete space",
    })
    if (ok) await deleteSpace(space.id)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={-1}
          onClick={() => useUi.getState().setView({ type: "space", id: space.id })}
          onDoubleClick={() => useUi.getState().setRenamingSpace(space.id)}
          className={cn(
            "flex h-8 cursor-pointer items-center gap-2.5 rounded-md px-2.5 transition-colors duration-75 outline-none",
            active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
            clipOver && "bg-primary/15 text-foreground ring-1 ring-primary/40",
            isDragging && "opacity-40",
          )}
        >
          <span className="flex size-4 items-center justify-center">
            <SpaceDot id={space.id} />
          </span>
          {renaming ? <RenameInput space={space} /> : <span className="flex-1 truncate">{space.name}</span>}
          {!renaming && count > 0 && <span className="text-caption text-subtle tabular-nums">{count}</span>}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44" onCloseAutoFocus={onCloseAutoFocus}>
        <ContextMenuItem onSelect={() => defer(() => useUi.getState().setRenamingSpace(space.id))}>Rename</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => void remove()}>
          Delete space
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

function RenameInput({ space }: { space: Space }) {
  const [value, setValue] = useState(space.name)
  const finish = (save: boolean) => {
    if (save && value.trim() && value !== space.name) void renameSpace(space.id, value)
    useUi.getState().setRenamingSpace(null)
  }
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === "Enter") finish(true)
        if (e.key === "Escape") finish(false)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="-ml-1.5 h-6 min-w-0 flex-1 rounded-sm bg-background px-1.5 ring-1 ring-primary/50 outline-none"
    />
  )
}

function Footer({ revision }: { revision: number }) {
  const storage = useStorage(revision)
  const actions = useActions()
  const { theme, setTheme } = useTheme()
  const { counts } = useData()

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border pt-3 pl-2.5">
      <div
        className="flex min-w-0 flex-1 flex-col gap-1.5"
        title={storage?.persisted ? "Storage is persistent" : "Browser may evict data under storage pressure"}
      >
        <div className="flex items-baseline justify-between text-caption text-subtle">
          <span>{storage ? formatBytes(storage.usage) : "—"} used</span>
          {storage && !storage.persisted && <span className="text-amber-500/80">not persisted</span>}
        </div>
        <div className="h-[3px] overflow-hidden rounded-full bg-sidebar-accent">
          <div
            className="h-full rounded-full bg-primary/70 transition-[width] duration-500"
            style={{ width: storage?.quota ? `${Math.max(1.5, (storage.usage / storage.quota) * 100)}%` : "0%" }}
          />
        </div>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Settings" className="text-subtle">
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="w-52">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
            <DropdownMenuRadioItem value="system">
              <Monitor /> System
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">
              <Sun /> Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">
              <Moon /> Dark
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void actions.exportAll()}>
            <Download /> Export backup
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.importFrom()}>
            <Upload /> Import backup
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => useUi.getState().setOverlay("shortcuts")}>
            <Keyboard /> Keyboard shortcuts
          </DropdownMenuItem>
          {counts.trash > 0 && (
            <DropdownMenuItem variant="destructive" onSelect={() => void actions.clearTrash()}>
              <Trash2 /> Empty trash
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * Fixed in the window corner rather than living in either header, so it stays put while the sidebar
 * slides; the sidebar's logo row and the list header both leave room for it.
 */
export function SidebarToggle() {
  const open = useUi((s) => s.sidebarOpen)
  const label = open ? "Hide sidebar" : "Show sidebar"
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={() => useUi.getState().setSidebarOpen(!open)}
          className="fixed top-[calc(1.125rem+1px)] left-3 z-30 text-muted-foreground"
        >
          <PanelLeft />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">
        {label}
        <Kbd>[</Kbd>
      </TooltipContent>
    </Tooltip>
  )
}

/** Same mark as public/logo.svg, tinted with the theme accent. */
function Logo() {
  return (
    <svg viewBox="0 0 512 512" className="size-5 text-primary" aria-hidden>
      <rect width="512" height="512" rx="116" fill="currentColor" />
      <rect x="172" y="104" width="232" height="268" rx="44" fill="#fff" fillOpacity=".28" />
      <rect x="124" y="148" width="248" height="268" rx="44" fill="#fff" />
      <rect x="198" y="120" width="100" height="58" rx="24" fill="currentColor" />
      <rect x="216" y="134" width="64" height="30" rx="15" fill="#fff" />
      <rect x="168" y="236" width="160" height="28" rx="14" fill="currentColor" />
      <rect x="168" y="286" width="160" height="28" rx="14" fill="currentColor" fillOpacity=".55" />
      <rect x="168" y="336" width="96" height="28" rx="14" fill="currentColor" fillOpacity=".3" />
    </svg>
  )
}
