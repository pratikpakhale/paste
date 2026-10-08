import { createContext, use } from "react"
import type { Clip, Space } from "@/db/schema"
import type { KindGroup } from "./route"

export interface Data {
  ready: boolean
  /** Every clip not in the trash. */
  live: Clip[]
  trashed: Clip[]
  spaces: Space[]
  /** The current view, filtered by search and sorted. */
  visible: Clip[]
  byId: Map<string, Clip>
  counts: Counts
  /** Whether manual drag-and-drop ordering makes sense for what's on screen. */
  canReorder: boolean
}

export interface Counts {
  all: number
  pinned: number
  trash: number
  kinds: Record<KindGroup, number>
  spaces: Record<string, number>
}

export const DataContext = createContext<Data | null>(null)

export function useData(): Data {
  const data = use(DataContext)
  if (!data) throw new Error("useData must be used inside <DataProvider>")
  return data
}
