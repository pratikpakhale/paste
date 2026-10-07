import { useRef } from "react"

/**
 * Radix menus and dialogs hand focus back to where it was when they close, which would immediately blur
 * an input the chosen item just focused. `defer` holds such an item until that handoff, and runs it instead.
 * Spread `onCloseAutoFocus` onto the menu or dialog content.
 */
export function useDeferredFocus() {
  const pending = useRef<(() => void) | null>(null)
  return {
    defer: (run: () => void) => {
      pending.current = run
    },
    onCloseAutoFocus: (event: Event) => {
      const run = pending.current
      if (!run) return
      pending.current = null
      event.preventDefault()
      run()
    },
  }
}
