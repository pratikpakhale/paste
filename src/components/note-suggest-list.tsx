import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { SuggestItem } from "./note-suggest"

export interface ListProps {
  items: SuggestItem[]
  command: (item: SuggestItem) => void
  empty: string
}

export interface ListHandle {
  onKeyDown: (event: KeyboardEvent) => boolean
}

export const SuggestList = forwardRef<ListHandle, ListProps>(function SuggestList({ items, command, empty }, ref) {
  // The highlight goes back to the top whenever the items change.
  const [highlight, setHighlight] = useState({ items, index: 0 })
  const index = highlight.items === items ? highlight.index : 0
  const setIndex = (next: (i: number) => number) => setHighlight({ items, index: next(index) })
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    list.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" })
  }, [index])

  useImperativeHandle(ref, () => ({
    onKeyDown: (event) => {
      if (!items.length) return false
      if (event.key === "ArrowDown") return (setIndex((i) => (i + 1) % items.length), true)
      if (event.key === "ArrowUp") return (setIndex((i) => (i - 1 + items.length) % items.length), true)
      if (event.key === "Enter" || event.key === "Tab") {
        const item = items[index]
        if (item) command(item)
        return true
      }
      return false
    },
  }))

  return (
    <div
      ref={list}
      role="listbox"
      className="z-50 max-h-80 w-64 scrollbar-thin overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {items.length === 0 && <div className="px-2 py-1.5 text-detail text-subtle">{empty}</div>}
      {items.map((item, i) => (
        <div key={item.id}>
          {item.group && item.group !== items[i - 1]?.group && (
            <div className="px-2 pt-2 pb-1 text-caption font-medium text-subtle">{item.group}</div>
          )}
          <button
            type="button"
            role="option"
            aria-selected={i === index}
            data-index={i}
            // Keep the editor's selection: a mousedown here would blur it.
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setIndex(() => i)}
            onClick={() => command(item)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
              i === index && "bg-accent text-accent-foreground",
            )}
          >
            {item.icon && <item.icon className="size-4 shrink-0 text-muted-foreground" />}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.detail && <span className="max-w-[45%] shrink-0 truncate text-caption text-subtle tabular-nums">{item.detail}</span>}
          </button>
        </div>
      ))}
    </div>
  )
})
