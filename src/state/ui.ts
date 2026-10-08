import { create } from "zustand"
import { persist } from "zustand/middleware"
import { onRouteChange, sameView } from "./route"

export type SortMode = "manual" | "newest" | "oldest" | "copied"
export type Layout = "list" | "grid"
export type Overlay = "palette" | "move" | "shortcuts" | null

export interface Queue {
  ids: string[]
  /** Index of the next clip to copy. */
  index: number
}

/** What's on screen and how it's arranged. Where the tab is (view and note) lives in the URL; see ./route. */
interface UiState {
  sort: SortMode
  layout: Layout
  query: string
  selected: string[]
  /** The clip keyboard navigation moves from and the detail pane shows. */
  cursor: string | null
  /** Fixed end of a shift-range selection. */
  anchor: string | null
  queue: Queue | null
  overlay: Overlay
  /** Space whose name is being edited inline in the sidebar. */
  renamingSpace: string | null
  sidebarOpen: boolean

  setSort: (sort: SortMode) => void
  setLayout: (layout: Layout) => void
  setQuery: (query: string) => void
  /** `ordered` is the visible list, needed to resolve shift-ranges. */
  select: (id: string, mode: "replace" | "toggle" | "range", ordered: readonly string[]) => void
  setSelection: (ids: string[], cursor?: string | null) => void
  clearSelection: () => void
  setQueue: (queue: Queue | null) => void
  setOverlay: (overlay: Overlay) => void
  setRenamingSpace: (id: string | null) => void
  setSidebarOpen: (open: boolean) => void
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      sort: "manual",
      layout: "list",
      query: "",
      selected: [],
      cursor: null,
      anchor: null,
      queue: null,
      overlay: null,
      renamingSpace: null,
      sidebarOpen: true,

      setSort: (sort) => set({ sort }),
      setLayout: (layout) => set({ layout }),
      setQuery: (query) => set({ query }),

      select: (id, mode, ordered) => {
        const { selected, anchor } = get()
        if (mode === "toggle") {
          const next = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
          set({ selected: next, cursor: next.includes(id) ? id : (next.at(-1) ?? null), anchor: id })
          return
        }
        if (mode === "range" && anchor) {
          const a = ordered.indexOf(anchor)
          const b = ordered.indexOf(id)
          if (a !== -1 && b !== -1) {
            const [from, to] = a < b ? [a, b] : [b, a]
            set({ selected: ordered.slice(from, to + 1), cursor: id })
            return
          }
        }
        set({ selected: [id], cursor: id, anchor: id })
      },

      setSelection: (ids, cursor) =>
        set({ selected: ids, cursor: cursor === undefined ? (ids.at(-1) ?? null) : cursor, anchor: ids[0] ?? null }),
      clearSelection: () => set({ selected: [], cursor: null, anchor: null }),
      setQueue: (queue) => set({ queue }),
      setOverlay: (overlay) => set({ overlay }),
      setRenamingSpace: (renamingSpace) => set({ renamingSpace }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
    }),
    {
      name: "paste:ui",
      version: 2,
      partialize: ({ sort, layout, sidebarOpen }) => ({ sort, layout, sidebarOpen }),
      // Version 1 stored the view, which would now override opening on a blank page.
      migrate: (state) => {
        const { view: _, ...rest } = state as Pick<UiState, "sort" | "layout" | "sidebarOpen"> & { view?: unknown }
        return rest
      },
    },
  ),
)

// A new view starts with nothing filtered or selected, however it was reached.
onRouteChange((route, prev) => {
  if (!sameView(route.view, prev.view)) useUi.setState({ query: "", selected: [], cursor: null, anchor: null, queue: null })
})
