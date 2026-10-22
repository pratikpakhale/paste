import { Extension } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
import { Suggestion } from "@tiptap/suggestion"
import {
  Calculator,
  ChevronRight,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from "lucide-react"
import { filterItems, type SuggestItem, suggestRenderer } from "./note-suggest"

export const slashKey = new PluginKey("slash")

interface SlashOptions {
  /** Opens a file chooser and puts the chosen files in at the caret. */
  pickFiles: () => void
}

type SlashItem = SuggestItem & { keywords?: string }

function items(options: SlashOptions): SlashItem[] {
  return [
    {
      id: "text",
      label: "Text",
      icon: Pilcrow,
      keywords: "paragraph plain",
      run: (e, r) => e.chain().focus().deleteRange(r).setParagraph().run(),
    },
    {
      id: "h1",
      label: "Heading 1",
      icon: Heading1,
      detail: "#",
      keywords: "title",
      run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 1 }).run(),
    },
    {
      id: "h2",
      label: "Heading 2",
      icon: Heading2,
      detail: "##",
      keywords: "subtitle",
      run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 2 }).run(),
    },
    {
      id: "h3",
      label: "Heading 3",
      icon: Heading3,
      detail: "###",
      run: (e, r) => e.chain().focus().deleteRange(r).setHeading({ level: 3 }).run(),
    },
    {
      id: "bullets",
      label: "Bulleted list",
      icon: List,
      detail: "-",
      keywords: "unordered ul",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run(),
    },
    {
      id: "numbers",
      label: "Numbered list",
      icon: ListOrdered,
      detail: "1.",
      keywords: "ordered ol",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run(),
    },
    {
      id: "tasks",
      label: "To-do list",
      icon: ListChecks,
      detail: "[ ]",
      keywords: "task checkbox check",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run(),
    },
    {
      id: "toggle",
      label: "Toggle",
      icon: ChevronRight,
      keywords: "details collapse fold",
      run: (e, r) => e.chain().focus().deleteRange(r).setDetails().run(),
    },
    {
      id: "quote",
      label: "Quote",
      icon: Quote,
      detail: ">",
      keywords: "blockquote",
      run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run(),
    },
    {
      id: "code",
      label: "Code block",
      icon: Code,
      detail: "```",
      keywords: "snippet pre",
      run: (e, r) => e.chain().focus().deleteRange(r).setCodeBlock().run(),
    },
    {
      id: "calc",
      label: "Calculation",
      icon: Calculator,
      detail: "```calc",
      keywords: "math calculator sum numbers units currency sheet",
      run: (e, r) => e.chain().focus().deleteRange(r).insertCalcBlock().run(),
    },
    {
      id: "table",
      label: "Table",
      icon: Table,
      keywords: "grid rows columns",
      run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: "divider",
      label: "Divider",
      icon: Minus,
      detail: "---",
      keywords: "rule line hr separator",
      run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run(),
    },
    {
      id: "file",
      label: "Image or file",
      icon: ImagePlus,
      keywords: "upload picture photo attachment",
      run: (e, r) => {
        e.chain().focus().deleteRange(r).run()
        options.pickFiles()
      },
    },
  ]
}

/** `/` at the start of a word opens a menu of every kind of block. */
export const SlashMenu = Extension.create<SlashOptions>({
  name: "slashMenu",
  addOptions: () => ({ pickFiles: () => {} }),
  addProseMirrorPlugins() {
    const all = items(this.options)
    return [
      Suggestion<SuggestItem, SuggestItem>({
        editor: this.editor,
        pluginKey: slashKey,
        char: "/",
        // Not inside code or calculations, where `/` is division or a path.
        allow: ({ state, range }) => {
          const parent = state.doc.resolve(range.from).parent
          return !parent.type.spec.code
        },
        items: ({ query }) => filterItems(all, query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: suggestRenderer("No matching block"),
      }),
    ]
  },
})
