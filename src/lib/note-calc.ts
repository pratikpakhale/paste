import { mergeAttributes, Node } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    calcBlock: {
      /** Puts a calc block at the caret (in place of an empty paragraph) with these lines, caret on the first. */
      insertCalcBlock: (lines?: string[]) => ReturnType
    }
  }
}

/**
 * A calculation block: every line is worked out, and its answer is drawn beside it (never stored in the note).
 * Each line carries a stable `id` (UniqueID), so a reference to it keeps pointing at that line through edits.
 */
export const CalcBlock = Node.create({
  name: "calcBlock",
  group: "block",
  content: "calcLine+",
  defining: true,
  isolating: true,
  parseHTML() {
    return [{ tag: "div[data-calc]" }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-calc": "", spellcheck: "false" }, HTMLAttributes), 0]
  },
  // One line per line: the generic text export would put a blank line before the first.
  renderText: ({ node }) => {
    const lines: string[] = []
    node.forEach((line) => lines.push(lineText(line)))
    return lines.join("\n")
  },
  renderMarkdown: (node, h) => ["```calc", h.renderChildren(node.content ?? [], "\n"), "```"].join("\n"),
  addCommands() {
    return {
      insertCalcBlock:
        (lines = [""]) =>
        ({ state, tr, dispatch }) => {
          const { schema } = state
          const block = schema.nodes.calcBlock!.create(
            null,
            lines.map((line) => schema.nodes.calcLine!.create(null, line ? schema.text(line) : undefined)),
          )
          const { $from } = state.selection
          const emptyParagraph = $from.parent.type.name === "paragraph" && $from.parent.content.size === 0
          const at = emptyParagraph ? $from.before() : $from.after()
          if (emptyParagraph) tr.replaceWith(at, $from.after(), block)
          else tr.insert(at, block)
          tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView()
          dispatch?.(tr)
          return true
        },
    }
  },
})

/** One line of a calc block: plain text and references, no formatting, no markdown shortcuts. */
export const CalcLine = Node.create({
  name: "calcLine",
  content: "(text | calcRef)*",
  marks: "",
  code: true,
  defining: true,
  parseHTML() {
    return [{ tag: "div[data-calc-line]", preserveWhitespace: "full" }]
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-calc-line": "" }, HTMLAttributes), 0]
  },
  renderMarkdown: (node, h) => h.renderChildren(node.content ?? []),
})

/**
 * Another line's answer, used in a calculation. `label` is what the line said when the reference was made, so
 * text copies stay readable without the calculator.
 */
export const CalcRef = Node.create({
  name: "calcRef",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      target: { default: null, parseHTML: (el) => el.getAttribute("data-target"), renderHTML: (a) => ({ "data-target": a.target }) },
      label: { default: "", parseHTML: (el) => el.textContent ?? "", renderHTML: () => ({}) },
    }
  },
  parseHTML() {
    return [{ tag: "span[data-calc-ref]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["span", mergeAttributes({ "data-calc-ref": "" }, HTMLAttributes), String(node.attrs.label)]
  },
  renderText({ node }) {
    return String(node.attrs.label)
  },
  renderMarkdown: (node) => String(node.attrs?.label ?? ""),
})

/** A calc line as the calculator reads it: references become `@{id}`. */
export function calcLineSource(line: PMNode): string {
  let text = ""
  line.forEach((child) => {
    if (child.isText) text += child.text ?? ""
    else if (child.type.name === "calcRef") text += `@{${child.attrs.target}}`
  })
  return text
}

/** A calc line as people read it: references show the label they were made with. */
function lineText(line: PMNode): string {
  let text = ""
  line.forEach((child) => (text += child.isText ? (child.text ?? "") : String(child.attrs.label ?? "")))
  return text
}
