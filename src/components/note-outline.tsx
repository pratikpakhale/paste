import type { Editor } from "@tiptap/core"
import { useEditorState } from "@tiptap/react"
import { cn } from "@/lib/utils"

interface Heading {
  level: number
  text: string
  pos: number
}

/** Below this many headings a note is short enough to scroll. */
const MIN_HEADINGS = 3

/** A long note's headings in the margin, to jump between. Read from the document, never written to it. */
export function NoteOutline({ editor }: { editor: Editor }) {
  const { headings, current } = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const found: Heading[] = []
      e.state.doc.descendants((node, pos) => {
        if (node.type.name === "heading") found.push({ level: node.attrs.level as number, text: node.textContent, pos })
        return node.type.name !== "heading" && node.isBlock && !node.isTextblock
      })
      const caret = e.state.selection.from
      return { headings: found, current: found.findLast((h) => h.pos <= caret)?.pos ?? -1 }
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })

  if (headings.length < MIN_HEADINGS) return null

  const jump = (pos: number) => {
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run()
    const dom = editor.view.nodeDOM(pos)
    if (dom instanceof HTMLElement) dom.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  return (
    <nav aria-label="Outline" className="fixed top-28 right-6 hidden w-52 flex-col gap-0.5 2xl:flex">
      {headings.map((h) => (
        <button
          key={h.pos}
          type="button"
          onClick={() => jump(h.pos)}
          style={{ paddingLeft: `${(h.level - 1) * 0.75 + 0.5}rem` }}
          className={cn(
            "truncate rounded-md py-1 pr-2 text-left text-detail text-subtle transition-colors hover:bg-accent hover:text-foreground",
            h.pos === current && "text-foreground",
          )}
        >
          {h.text || "Untitled"}
        </button>
      ))}
    </nav>
  )
}
