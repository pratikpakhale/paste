import type { Editor } from "@tiptap/core"
import { NodeSelection } from "@tiptap/pm/state"
import { useEditorState } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import {
  ArrowDownToLine,
  ArrowRightToLine,
  Bold,
  Code,
  ExternalLink,
  Heading1,
  Heading2,
  Highlighter,
  Italic,
  Link2,
  Link2Off,
  List,
  Quote,
  Rows3,
  Strikethrough,
  Table2,
  Trash2,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

const MENU = "flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"

function MenuButton({
  label,
  keys,
  active,
  onClick,
  children,
}: {
  label: string
  keys?: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          // A mousedown would move focus out of the editor and close the menu.
          onMouseDown={(event) => event.preventDefault()}
          onClick={onClick}
          className={cn(
            "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground [&_svg]:size-4",
            active && "bg-accent text-foreground",
          )}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <span className="ml-2 text-subtle">{keys}</span>}
      </TooltipContent>
    </Tooltip>
  )
}

const Divider = () => <span className="mx-0.5 h-4 w-px bg-border" />

/** Text the menu can format: a range of text, not an image or file, not in code or a calculation. */
function formattable(editor: Editor): boolean {
  const { selection } = editor.state
  if (!editor.isEditable || selection.empty || selection instanceof NodeSelection) return false
  return !selection.$from.parent.type.spec.code && !selection.$to.parent.type.spec.code
}

/** Accepts `example.com` as well as full URLs; anything without a scheme is taken to be a web address. */
function normalizeUrl(input: string): string {
  const value = input.trim()
  if (!value) return ""
  return /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`
}

/** Formatting for selected text, and editing for the link under the caret. */
export function NoteBubbleMenu({ editor }: { editor: Editor }) {
  const [editingLink, setEditingLink] = useState(false)
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      strike: e.isActive("strike"),
      code: e.isActive("code"),
      highlight: e.isActive("highlight"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      h1: e.isActive("heading", { level: 1 }),
      h2: e.isActive("heading", { level: 2 }),
      bullets: e.isActive("bulletList"),
      quote: e.isActive("blockquote"),
      empty: e.state.selection.empty,
    }),
  })

  // A new selection starts on the formatting buttons again.
  useEffect(() => {
    const reset = () => setEditingLink(false)
    editor.on("selectionUpdate", reset)
    return () => void editor.off("selectionUpdate", reset)
  }, [editor])

  const chain = () => editor.chain().focus()

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="noteBubble"
      shouldShow={({ editor: e }) => e.isEditable && (formattable(e) || (e.isActive("link") && e.state.selection.empty))}
      options={{ placement: "top", offset: 8, flip: true, shift: { padding: 8 } }}
      className="z-40"
    >
      {editingLink ? (
        <LinkForm
          initial={state.href}
          onSubmit={(url) => {
            const href = normalizeUrl(url)
            if (href) chain().extendMarkRange("link").setLink({ href }).run()
            else chain().extendMarkRange("link").unsetLink().run()
            setEditingLink(false)
          }}
          onCancel={() => {
            setEditingLink(false)
            editor.commands.focus()
          }}
        />
      ) : state.link && state.empty ? (
        <div className={MENU}>
          <a
            href={state.href}
            target="_blank"
            rel="noreferrer"
            className="max-w-64 truncate px-2 text-detail text-primary underline-offset-2 hover:underline"
          >
            {state.href}
          </a>
          <Divider />
          <MenuButton label="Open link" onClick={() => window.open(state.href, "_blank", "noopener,noreferrer")}>
            <ExternalLink />
          </MenuButton>
          <MenuButton label="Edit link" onClick={() => setEditingLink(true)}>
            <Link2 />
          </MenuButton>
          <MenuButton label="Remove link" onClick={() => chain().extendMarkRange("link").unsetLink().run()}>
            <Link2Off />
          </MenuButton>
        </div>
      ) : (
        <div className={MENU}>
          <MenuButton label="Bold" keys="⌘B" active={state.bold} onClick={() => chain().toggleBold().run()}>
            <Bold />
          </MenuButton>
          <MenuButton label="Italic" keys="⌘I" active={state.italic} onClick={() => chain().toggleItalic().run()}>
            <Italic />
          </MenuButton>
          <MenuButton label="Strikethrough" keys="⌘⇧S" active={state.strike} onClick={() => chain().toggleStrike().run()}>
            <Strikethrough />
          </MenuButton>
          <MenuButton label="Code" keys="⌘E" active={state.code} onClick={() => chain().toggleCode().run()}>
            <Code />
          </MenuButton>
          <MenuButton label="Highlight" keys="⌘⇧H" active={state.highlight} onClick={() => chain().toggleHighlight().run()}>
            <Highlighter />
          </MenuButton>
          <MenuButton label={state.link ? "Edit link" : "Link"} active={state.link} onClick={() => setEditingLink(true)}>
            <Link2 />
          </MenuButton>
          <Divider />
          <MenuButton label="Heading 1" keys="⌘⌥1" active={state.h1} onClick={() => chain().toggleHeading({ level: 1 }).run()}>
            <Heading1 />
          </MenuButton>
          <MenuButton label="Heading 2" keys="⌘⌥2" active={state.h2} onClick={() => chain().toggleHeading({ level: 2 }).run()}>
            <Heading2 />
          </MenuButton>
          <MenuButton label="Bulleted list" keys="⌘⇧8" active={state.bullets} onClick={() => chain().toggleBulletList().run()}>
            <List />
          </MenuButton>
          <MenuButton label="Quote" keys="⌘⇧B" active={state.quote} onClick={() => chain().toggleBlockquote().run()}>
            <Quote />
          </MenuButton>
        </div>
      )}
    </BubbleMenu>
  )
}

function LinkForm({ initial, onSubmit, onCancel }: { initial: string; onSubmit: (url: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  return (
    <form
      className={cn(MENU, "gap-1 p-1.5")}
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <input
        ref={input}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
        placeholder="Paste or type a link…"
        aria-label="Link address"
        className="h-7 w-64 rounded-md bg-transparent px-2 text-detail outline-none placeholder:text-subtle"
      />
      <button type="submit" className="h-7 rounded-md bg-primary px-2.5 text-caption font-medium text-primary-foreground">
        {value.trim() ? "Save" : "Remove"}
      </button>
    </form>
  )
}

/** Row and column actions for the table the caret is in. */
export function NoteTableMenu({ editor }: { editor: Editor }) {
  const chain = () => editor.chain().focus()
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="noteTable"
      // Selected text in a cell gets the formatting menu instead.
      shouldShow={({ editor: e }) => e.isEditable && e.isActive("table") && e.state.selection.empty && !e.isActive("link")}
      options={{ placement: "top", offset: 8, flip: true, shift: { padding: 8 } }}
      className="z-40"
    >
      <div className={MENU}>
        <MenuButton label="Add row below" onClick={() => chain().addRowAfter().run()}>
          <ArrowDownToLine />
        </MenuButton>
        <MenuButton label="Add column right" onClick={() => chain().addColumnAfter().run()}>
          <ArrowRightToLine />
        </MenuButton>
        <MenuButton label="Header row on or off" onClick={() => chain().toggleHeaderRow().run()}>
          <Table2 />
        </MenuButton>
        <Divider />
        <MenuButton label="Delete row" onClick={() => chain().deleteRow().run()}>
          <Rows3 />
        </MenuButton>
        <MenuButton label="Delete column" onClick={() => chain().deleteColumn().run()}>
          <Rows3 className="rotate-90" />
        </MenuButton>
        <MenuButton label="Delete table" onClick={() => chain().deleteTable().run()}>
          <Trash2 />
        </MenuButton>
      </div>
    </BubbleMenu>
  )
}
