import { createLoader, createParser, createSerializer, parseAsString, useQueryStates } from "nuqs"
import { enableHistorySync } from "nuqs/adapters/react"
import type { ClipKind } from "@/db/schema"

export const KIND_GROUPS = {
  notes: ["note"],
  text: ["text", "markdown"],
  code: ["code", "json"],
  links: ["link"],
  colors: ["color"],
  images: ["image"],
  media: ["video", "audio"],
  files: ["pdf", "file"],
} as const satisfies Record<string, readonly ClipKind[]>

export type KindGroup = keyof typeof KIND_GROUPS

export type View =
  | { type: "write" }
  | { type: "all" }
  | { type: "pinned" }
  | { type: "kind"; group: KindGroup }
  | { type: "space"; id: string }
  | { type: "trash" }

const WRITE: View = { type: "write" }

function viewKey(view: View): string {
  switch (view.type) {
    case "kind":
      return view.group
    case "space":
      return `space:${view.id}`
    default:
      return view.type
  }
}

export const sameView = (a: View, b: View) => viewKey(a) === viewKey(b)

/** `?view=all`, `?view=images`, `?view=space:<id>`; Write is the bare URL. */
const parseAsView = createParser<View>({
  parse: (value) => {
    if (value === "all" || value === "pinned" || value === "trash") return { type: value }
    if (value in KIND_GROUPS) return { type: "kind", group: value as KindGroup }
    if (value.startsWith("space:") && value.length > 6) return { type: "space", id: value.slice(6) }
    return null
  },
  serialize: viewKey,
  eq: (a, b) => viewKey(a) === viewKey(b),
}).withDefault(WRITE)

/**
 * Where the tab is: the view, and the note it writes in. The note stays in the URL across views,
 * so each tab keeps its own note through navigation and reloads (storage is shared by every tab).
 */
const routeParsers = { view: parseAsView, note: parseAsString }

export type Route = { view: View; note: string | null }

const loadRoute = createLoader(routeParsers)
const serializeRoute = createSerializer(routeParsers)

// Writes go through the History API from anywhere in the app; this keeps nuqs' hooks in step with them.
enableHistorySync()

export function getRoute(): Route {
  return loadRoute(location.search)
}

export function useRoute(): Route {
  return useQueryStates(routeParsers)[0]
}

export const useView = () => useRoute().view
export const useNote = () => useRoute().note

type Listener = (route: Route, prev: Route) => void
const listeners = new Set<Listener>()
let current = getRoute()

/** Runs on every route change, whether from `navigate` or the browser's back and forward. */
export function onRouteChange(listener: Listener): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

function settle() {
  const prev = current
  current = getRoute()
  if (viewKey(prev.view) === viewKey(current.view) && prev.note === current.note) return
  for (const listener of listeners) listener(current, prev)
}

window.addEventListener("popstate", settle)

/**
 * Changes the route. Going somewhere pushes a history entry so back returns; corrections the app
 * makes on its own (a missing space or note) replace the entry instead.
 */
export function navigate(next: Partial<Route>, { replace = false }: { replace?: boolean } = {}) {
  const url = serializeRoute(location.href, next)
  if (url === location.href) return
  history[replace ? "replaceState" : "pushState"](history.state, "", url)
  settle()
}
