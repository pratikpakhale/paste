import { type Editor, Extension, InputRule } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import { type EditorState, Plugin, PluginKey, TextSelection } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import { Suggestion } from "@tiptap/suggestion"
import { Hash, Variable } from "lucide-react"
import { toast } from "sonner"
import type { CalcInput, CalcResult } from "@/lib/calc/types"
import { calcLineSource } from "@/lib/note-calc"
import { looksLikeCalculation } from "@/lib/calc"
import { calcOptions, currentCalc, ensureCalc, onCalcChange, setCalcSummary } from "@/state/calc"
import { useSettings } from "@/state/settings"
import { filterItems, type SuggestItem, suggestRenderer } from "./note-suggest"

/** Where a line the calculator read sits in the document, so its answer can be drawn there. */
interface Line {
  id: string
  kind: "sheet" | "prose"
  /** Position before the line's node. */
  pos: number
  node: PMNode
}

interface CalcState {
  inputs: CalcInput[]
  lines: Line[]
  results: Map<string, CalcResult>
}

export const calcKey = new PluginKey<CalcState>("calc")
export const refPickerKey = new PluginKey("calcRefs")

/** A paragraph that asks for its answer by ending in `=` or `=>`; others answer only if wholly a calculation. */
const ASKS = /=>?\s*$/
/** Paragraphs the calculator can have anything to say about: a digit, an operator or a name being declared. */
const CANDIDATE = /[\d=+*/^%×÷$€£₹¥]/
/** Past this a paragraph is writing, not a calculation; skipping it keeps long notes cheap. */
const MAX_PROSE_LINE = 300

/** Every line of the note the calculator should see, top to bottom. */
function collect(doc: PMNode): { inputs: CalcInput[]; lines: Line[]; wanted: boolean } {
  const inputs: CalcInput[] = []
  const lines: Line[] = []
  let wanted = false
  doc.descendants((node, pos) => {
    switch (node.type.name) {
      case "heading":
        inputs.push({ kind: "heading" })
        return false
      case "horizontalRule":
        inputs.push({ kind: "divider" })
        return false
      case "codeBlock":
        return false
      case "calcBlock": {
        const block = String(node.attrs.id ?? `b${pos}`)
        wanted = true
        node.forEach((line, offset) => {
          const id = String(line.attrs.id ?? `l${pos + 1 + offset}`)
          inputs.push({ kind: "sheet", id, block, text: calcLineSource(line) })
          lines.push({ id, kind: "sheet", pos: pos + 1 + offset, node: line })
        })
        return false
      }
      case "paragraph": {
        const text = node.textContent
        if (text.length > MAX_PROSE_LINE || !CANDIDATE.test(text)) return false
        const id = `p${pos}`
        if (ASKS.test(text) || (useSettings.getState().autoAnswers && looksLikeCalculation(text))) wanted = true
        inputs.push({ kind: "prose", id, text })
        lines.push({ id, kind: "prose", pos, node })
        return false
      }
      default:
        return true
    }
  })
  return { inputs, lines, wanted }
}

function evaluate(doc: PMNode): CalcState {
  const { inputs, lines, wanted } = collect(doc)
  const calc = currentCalc()
  if (!calc) {
    if (wanted) void ensureCalc()
    return { inputs, lines, results: new Map() }
  }
  return { inputs, lines, results: calc.evaluate(inputs, calcOptions()) }
}

/** What an answer copies: the shown answer without its `≈`, or every digit with ⌥. */
function copyAnswer(result: Extract<CalcResult, { kind: "value" }>, full: boolean) {
  const text = full ? result.full : result.display.replace(/^≈\s*/, "")
  void navigator.clipboard.writeText(text).then(
    () => toast.success(`Copied ${text}`),
    () => toast.error("Couldn't copy"),
  )
}

function answerWidget(result: Extract<CalcResult, { kind: "value" }>, className: string, text: string) {
  return (view: EditorView) => {
    const el = document.createElement("span")
    el.className = className
    el.contentEditable = "false"
    el.textContent = text
    el.title = [result.interpretation, result.approximate ? result.full : "", "Click to copy · ⌥-click for every digit"]
      .filter(Boolean)
      .join("\n")
    el.addEventListener("mousedown", (event) => event.preventDefault())
    el.addEventListener("click", (event) => {
      event.preventDefault()
      copyAnswer(result, event.altKey)
      view.focus()
    })
    return el
  }
}

function errorWidget(message: string, className: string) {
  return () => {
    const el = document.createElement("span")
    el.className = className
    el.contentEditable = "false"
    el.textContent = message
    el.title = message
    return el
  }
}

function caretIn(state: EditorState, line: Line): boolean {
  const { from, to } = state.selection
  return from >= line.pos && to <= line.pos + line.node.nodeSize
}

/** Text offsets of a line's source map onto the document only when it holds no references. */
function underline(line: Line, range: [number, number] | undefined): Decoration | null {
  if (!range || line.node.childCount !== 1 || !line.node.firstChild?.isText) return null
  const length = line.node.content.size
  const from = Math.min(range[0], length)
  const to = Math.min(Math.max(range[1], from + 1), length)
  if (from >= to) return null
  return Decoration.inline(line.pos + 1 + from, line.pos + 1 + to, { class: "calc-error-range" })
}

function decorations(state: EditorState): DecorationSet {
  const calc = calcKey.getState(state)
  if (!calc?.results.size) return DecorationSet.empty
  const decos: Decoration[] = []
  for (const line of calc.lines) {
    const result = calc.results.get(line.id)
    if (!result || result.kind === "silent") continue
    const end = line.pos + line.node.nodeSize - 1
    if (result.kind === "error") {
      // A line being typed isn't wrong yet: say so once the caret has moved on.
      if (caretIn(state, line)) continue
      if (line.kind === "prose" && !ASKS.test(line.node.textContent)) continue
      decos.push(
        Decoration.widget(end, errorWidget(result.message, line.kind === "sheet" ? "calc-answer calc-error" : "calc-ghost calc-error"), {
          side: 1,
          key: `e:${line.id}:${result.message}`,
          ignoreSelection: true,
        }),
      )
      const mark = underline(line, result.range)
      if (mark) decos.push(mark)
      continue
    }
    if (line.kind === "sheet") {
      decos.push(
        Decoration.widget(end, answerWidget(result, "calc-answer", result.display), {
          side: 1,
          key: `a:${line.id}:${result.display}`,
          ignoreSelection: true,
        }),
      )
    } else {
      // Unasked, the answer brings its own `=`.
      const text = ASKS.test(line.node.textContent) ? result.display : `= ${result.display}`
      decos.push(
        Decoration.widget(end, answerWidget(result, "calc-ghost", text), {
          side: 1,
          key: `g:${line.id}:${text}`,
          ignoreSelection: true,
        }),
      )
    }
  }
  return DecorationSet.create(state.doc, decos)
}

/** The answers of the lines a selection covers, for the footer's count, sum and average. */
function selectedResults(state: EditorState): CalcResult[] {
  const calc = calcKey.getState(state)
  const { from, to, empty } = state.selection
  if (!calc || empty) return []
  return calc.lines
    .filter((line) => line.pos + line.node.nodeSize > from && line.pos < to)
    .flatMap((line) => {
      const result = calc.results.get(line.id)
      return result?.kind === "value" ? [result] : []
    })
}

/**
 * What Tab writes after the caret, at the end of a paragraph showing an answer: the answer after an `=`,
 * ` = answer` after a calculation that didn't ask. In a list item, an unasked answer leaves Tab to indent.
 */
function answerAtCaret(state: EditorState): string | null {
  const { $from, empty } = state.selection
  if (!empty || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size) return null
  const calc = calcKey.getState(state)
  const line = calc?.lines.find((l) => l.pos === $from.before())
  const result = line && calc?.results.get(line.id)
  if (result?.kind !== "value") return null
  const text = $from.parent.textContent
  const answer = result.display.replace(/^≈\s*/, "")
  if (ASKS.test(text)) return `${/\s$/.test(text) ? "" : " "}${answer}`
  if ($from.depth > 1 && /^(?:listItem|taskItem)$/.test($from.node(-1).type.name)) return null
  return `${/\s$/.test(text) ? "" : " "}= ${answer}`
}

/** The caret is in a calc line, with no `@` menu open (an open menu gets the keys first). */
function inCalcLine(state: EditorState): boolean {
  if ((refPickerKey.getState(state) as { active?: boolean } | undefined)?.active) return false
  return state.selection.$from.parent.type.name === "calcLine"
}

/** Leaves a calc block onto the paragraph after it, making one if there isn't. */
function exitBlock(editor: Editor, removeEmptyLine: boolean): boolean {
  const { state } = editor
  const { $from } = state.selection
  const blockDepth = $from.depth - 1
  const block = $from.node(blockDepth)
  if (block.type.name !== "calcBlock") return false
  const tr = state.tr
  let after = $from.after(blockDepth)
  if (removeEmptyLine) {
    tr.delete($from.before(), $from.after())
    after = tr.mapping.map(after)
  }
  const next = tr.doc.resolve(after).nodeAfter
  if (!next?.isTextblock) tr.insert(after, state.schema.nodes.paragraph!.create())
  tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView()
  editor.view.dispatch(tr)
  return true
}

interface CalcEditingOptions {
  /** The note's id, for its footer summary. */
  noteId: string
}

/**
 * Notes that calculate: answers for calc blocks and for paragraphs ending in `=`, the keys that make calc lines
 * feel like a sheet, and `@` to use another line's answer.
 */
export const CalcEditing = Extension.create<CalcEditingOptions>({
  name: "calcEditing",
  // Ahead of the code block's ``` rule and the editor's own Enter.
  priority: 1000,
  addOptions: () => ({ noteId: "" }),

  addInputRules() {
    return [
      new InputRule({
        find: /^```calc[\s]$/,
        handler: ({ chain, range }) => {
          chain().deleteRange(range).insertCalcBlock().run()
        },
      }),
    ]
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        if (!inCalcLine(state)) return false
        const { $from } = state.selection
        const block = $from.node($from.depth - 1)
        const last = $from.index($from.depth - 1) === block.childCount - 1
        // Return on an empty last line leaves the block, as in a list.
        if (last && $from.parent.content.size === 0 && block.childCount > 1) return exitBlock(editor, true)
        return editor.commands.splitBlock()
      },
      "Mod-Enter": ({ editor }) => (inCalcLine(editor.state) ? exitBlock(editor, false) : false),
      ArrowDown: ({ editor }) => {
        const { state } = editor
        if (!inCalcLine(state) || !state.selection.empty) return false
        const { $from } = state.selection
        const block = $from.node($from.depth - 1)
        const last = $from.index($from.depth - 1) === block.childCount - 1
        if (!last || state.doc.resolve($from.after($from.depth - 1)).nodeAfter) return false
        return exitBlock(editor, false)
      },
      Backspace: ({ editor }) => {
        const { state } = editor
        if (!inCalcLine(state) || !state.selection.empty) return false
        const { $from } = state.selection
        const block = $from.node($from.depth - 1)
        // An emptied block turns back into a paragraph, like an emptied code block.
        if ($from.parentOffset !== 0 || block.childCount !== 1 || $from.parent.content.size !== 0) return false
        const pos = $from.before($from.depth - 1)
        return editor
          .chain()
          .command(({ tr }) => {
            tr.replaceWith(pos, pos + block.nodeSize, state.schema.nodes.paragraph!.create())
            tr.setSelection(TextSelection.create(tr.doc, pos + 1))
            return true
          })
          .run()
      },
      // Tab writes a paragraph's pending answer into the text.
      Tab: ({ editor }) => {
        const answer = answerAtCaret(editor.state)
        return answer ? editor.commands.insertContent(answer) : false
      },
    }
  },

  addProseMirrorPlugins() {
    const noteId = this.options.noteId
    const editor = this.editor
    return [
      new Plugin<CalcState>({
        key: calcKey,
        state: {
          init: (_, state) => evaluate(state.doc),
          apply: (tr, value, _old, state) => (tr.docChanged || tr.getMeta(calcKey) ? evaluate(state.doc) : value),
        },
        props: { decorations },
        // ```calc pasted as markdown, or typed before this rule ran, arrives as a code block: make it a calc block.
        appendTransaction: (transactions, _old, state) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const blocks: { pos: number; node: PMNode }[] = []
          state.doc.descendants((node, pos) => {
            if (node.type.name === "codeBlock" && node.attrs.language === "calc") blocks.push({ pos, node })
            return !node.isTextblock
          })
          if (!blocks.length) return null
          const { schema } = state
          const tr = state.tr
          for (const { pos, node } of blocks.toReversed()) {
            const lines = node.textContent
              .split("\n")
              .map((line) => schema.nodes.calcLine!.create(null, line ? schema.text(line) : undefined))
            tr.replaceWith(pos, pos + node.nodeSize, schema.nodes.calcBlock!.create(null, lines))
          }
          return tr
        },
        view: (view) => {
          const recalc = () => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(calcKey, true))
          const stop = onCalcChange(recalc)
          return {
            update: (v) => {
              if (!noteId) return
              const results = selectedResults(v.state)
              const calc = currentCalc()
              setCalcSummary(noteId, results.length > 1 && calc ? calc.summarize(results, calcOptions()) : undefined)
            },
            destroy: () => {
              stop()
              if (noteId) setCalcSummary(noteId, undefined)
            },
          }
        },
      }),
      Suggestion<SuggestItem, SuggestItem>({
        editor,
        pluginKey: refPickerKey,
        char: "@",
        allowedPrefixes: null,
        allow: ({ state, range }) => state.doc.resolve(range.from).parent.type.name === "calcLine",
        items: ({ query, editor: e }) => filterItems(refItems(e.state), query),
        command: ({ editor: e, range, props }) => props.run(e, range),
        render: suggestRenderer("Nothing to refer to above"),
      }),
    ]
  },
})

/** Names in scope and the answered lines above the caret, for `@`. */
function refItems(state: EditorState): (SuggestItem & { keywords?: string })[] {
  const calc = calcKey.getState(state)
  const engine = currentCalc()
  if (!calc || !engine) return []
  const caret = state.selection.from
  const here = calc.lines.find((l) => caret >= l.pos && caret <= l.pos + l.node.nodeSize)
  const names = here ? engine.namesBefore(calc.inputs, here.id) : []
  const nameItems = names.map((n) => ({
    id: `name:${n.name}`,
    label: n.name,
    detail: n.display,
    icon: Variable,
    group: "Names",
    run: (e: Editor, range: { from: number; to: number }) => e.chain().focus().insertContentAt(range, `${n.name} `).run(),
  }))
  const lineItems = calc.lines
    .filter((l) => l.kind === "sheet" && l.pos + l.node.nodeSize <= caret)
    .flatMap((line) => {
      const result = calc.results.get(line.id)
      // A line that names its answer is offered by that name instead.
      if (result?.kind !== "value" || result.name) return []
      const label = refLabel(line.node)
      return [
        {
          id: `line:${line.id}`,
          label,
          detail: result.display,
          keywords: line.node.textContent,
          icon: Hash,
          group: "Lines",
          run: (e: Editor, range: { from: number; to: number }) =>
            e
              .chain()
              .focus()
              .insertContentAt(range, [
                { type: "calcRef", attrs: { target: line.id, label } },
                { type: "text", text: " " },
              ])
              .run(),
        },
      ]
    })
    .toReversed()
  return [...lineItems, ...nameItems]
}

/** What a reference to a line is called: its label, else its text. */
function refLabel(line: PMNode): string {
  const text = line.textContent.replace(/\/\/.*$/, "").trim()
  const label = /^([^:]+):\s/.exec(text)?.[1]
  return (label ?? text).slice(0, 32) || "line"
}

/** Lines with their answers, tab-separated, for pasting into chat or a spreadsheet. */
export function blockText(editor: Editor, block: PMNode, mode: "results" | "answers"): string {
  const calc = calcKey.getState(editor.state)
  const rows: string[] = []
  block.forEach((line) => {
    const result = calc?.results.get(String(line.attrs.id))
    const answer = result?.kind === "value" ? result.display.replace(/^≈\s*/, "") : ""
    if (mode === "answers") {
      if (answer) rows.push(answer)
    } else rows.push(answer ? `${line.textContent}\t${answer}` : line.textContent)
  })
  return rows.join("\n")
}
