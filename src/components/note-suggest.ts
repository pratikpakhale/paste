import type { Editor, Range } from "@tiptap/core"
import { ReactRenderer } from "@tiptap/react"
import type { SuggestionKeyDownProps, SuggestionOptions, SuggestionProps } from "@tiptap/suggestion"
import type { LucideIcon } from "lucide-react"
import { type ListHandle, type ListProps, SuggestList } from "./note-suggest-list"

/** A row in a `/` or `@` menu. */
export interface SuggestItem {
  id: string
  label: string
  /** Right-aligned and muted: a shortcut, a value, a preview. */
  detail?: string
  icon?: LucideIcon
  /** A group heading shown above the first item that has it. */
  group?: string
  run: (editor: Editor, range: Range) => void
}

function listProps(p: SuggestionProps<SuggestItem, SuggestItem>, empty: string): ListProps {
  return { items: p.items, command: p.command, empty }
}

/** Draws a suggestion's menu with React, anchored to the caret by the plugin itself. */
export function suggestRenderer(empty: string): SuggestionOptions<SuggestItem, SuggestItem>["render"] {
  return () => {
    let renderer: ReactRenderer<ListHandle, ListProps> | null = null
    let unmount: (() => void) | null = null
    return {
      onStart: (p) => {
        renderer = new ReactRenderer(SuggestList, { props: listProps(p, empty), editor: p.editor })
        unmount = p.mount(renderer.element)
      },
      onUpdate: (p) => renderer?.updateProps(listProps(p, empty)),
      onKeyDown: ({ event }: SuggestionKeyDownProps) => {
        if (event.key === "Escape") {
          unmount?.()
          unmount = null
          return true
        }
        return renderer?.ref?.onKeyDown(event) ?? false
      },
      onExit: () => {
        unmount?.()
        renderer?.destroy()
        renderer = null
        unmount = null
      },
    }
  }
}

/** Items whose label (or keywords) contain every word typed after the trigger. */
export function filterItems<T extends SuggestItem & { keywords?: string }>(items: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((item) => {
    const haystack = `${item.label} ${item.keywords ?? ""}`.toLowerCase()
    return words.every((w) => haystack.includes(w))
  })
}
