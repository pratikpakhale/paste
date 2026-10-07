/**
 * Imperative requests between components that don't share a parent worth lifting state into —
 * moving focus, mostly. Anything that is real state belongs in the UI store instead.
 */
type UiEvent = "paste:edit" | "paste:rename" | "paste:search"

function emit(name: UiEvent) {
  window.dispatchEvent(new Event(name))
}

function listen(name: UiEvent, handler: () => void): () => void {
  window.addEventListener(name, handler)
  return () => window.removeEventListener(name, handler)
}

/** Where a click asked the caret to go, in viewport coordinates. */
export interface EditPoint {
  x: number
  y: number
}

/** Open the selected clip's content for editing; with a point, put the caret nearest to it. */
export function requestEdit(point?: EditPoint) {
  window.dispatchEvent(new CustomEvent<EditPoint | undefined>("paste:edit", { detail: point }))
}
export function onEditRequest(handler: (point?: EditPoint) => void): () => void {
  const listener = (event: Event) => handler((event as CustomEvent<EditPoint | undefined>).detail)
  window.addEventListener("paste:edit", listener)
  return () => window.removeEventListener("paste:edit", listener)
}

/** Focus the selected clip's title. */
export const requestRename = () => emit("paste:rename")
export const onRenameRequest = (handler: () => void) => listen("paste:rename", handler)

/** Focus the current view's filter input. */
export const requestSearch = () => emit("paste:search")
export const onSearchRequest = (handler: () => void) => listen("paste:search", handler)
