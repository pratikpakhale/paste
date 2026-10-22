import type { Node as PMNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps, useEditorState } from "@tiptap/react"
import { Calculator, Copy, Hash, ListPlus, Pilcrow } from "lucide-react"
import type { ReactNode } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { blockText, calcKey } from "./note-calc"

/** A reference shows the answer it reads, live; hovering shows what it refers to. */
export function CalcRefView({ node, editor, selected }: ReactNodeViewProps) {
  const target = String(node.attrs.target)
  const result = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      const calc = e ? calcKey.getState(e.state) : undefined
      const found = calc?.lines.some((l) => l.id === target)
      if (!found) return { state: "missing" as const }
      const r = calc?.results.get(target)
      return r?.kind === "value" ? { state: "value" as const, display: r.display } : { state: "error" as const }
    },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })
  const label = String(node.attrs.label)
  return (
    <NodeViewWrapper
      as="span"
      title={result?.state === "missing" ? `“${label}” was deleted` : label}
      className={`calc-ref ${result?.state !== "value" ? "calc-ref-broken" : ""} ${selected ? "calc-ref-selected" : ""}`}
    >
      {result?.state === "value" ? result.display : result?.state === "missing" ? "deleted" : label}
    </NodeViewWrapper>
  )
}

export function CalcBlockView({ node, editor, getPos }: ReactNodeViewProps) {
  const copy = (mode: "results" | "answers") => {
    const text = blockText(editor, node, mode)
    void navigator.clipboard.writeText(text).then(
      () => toast.success(mode === "results" ? "Copied lines with answers" : "Copied answers"),
      () => toast.error("Couldn't copy"),
    )
  }
  const toText = () => {
    const pos = getPos()
    if (pos === undefined) return
    const { schema } = editor.state
    const paragraphs: PMNode[] = []
    node.forEach((line) =>
      paragraphs.push(schema.nodes.paragraph!.create(null, line.textContent ? schema.text(line.textContent) : undefined)),
    )
    editor
      .chain()
      .focus()
      .command(({ tr }) => (tr.replaceWith(pos, pos + node.nodeSize, paragraphs), true))
      .run()
  }
  const addLine = () => {
    const pos = getPos()
    if (pos === undefined) return
    const end = pos + node.nodeSize - 1
    editor
      .chain()
      .command(({ tr }) => {
        tr.insert(end, editor.schema.nodes.calcLine!.create())
        tr.setSelection(TextSelection.create(tr.doc, end + 1))
        return true
      })
      .focus()
      .run()
  }
  const editable = editor.isEditable

  return (
    <NodeViewWrapper className="calc-block group/calc">
      <div contentEditable={false} className="calc-toolbar">
        <span className="flex items-center gap-1.5 text-caption text-subtle select-none">
          <Calculator className="size-3.5" /> Calculation
        </span>
        <span className="ml-auto flex items-center opacity-0 transition-opacity group-focus-within/calc:opacity-100 group-hover/calc:opacity-100">
          <BlockAction label="Copy lines with answers" onClick={() => copy("results")}>
            <Copy />
          </BlockAction>
          <BlockAction label="Copy answers only" onClick={() => copy("answers")}>
            <Hash />
          </BlockAction>
          {editable && (
            <>
              <BlockAction label="Add a line" onClick={addLine}>
                <ListPlus />
              </BlockAction>
              <BlockAction label="Turn into text" onClick={toText}>
                <Pilcrow />
              </BlockAction>
            </>
          )}
        </span>
      </div>
      <NodeViewContent className="calc-lines" />
    </NodeViewWrapper>
  )
}

function BlockAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
