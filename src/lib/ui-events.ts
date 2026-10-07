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

/** Open the selected clip's content for editing. */
export const requestEdit = () => emit("paste:edit")
export const onEditRequest = (handler: () => void) => listen("paste:edit", handler)

/** Focus the selected clip's title. */
export const requestRename = () => emit("paste:rename")
export const onRenameRequest = (handler: () => void) => listen("paste:rename", handler)

/** Focus the current view's filter input. */
export const requestSearch = () => emit("paste:search")
export const onSearchRequest = (handler: () => void) => listen("paste:search", handler)
