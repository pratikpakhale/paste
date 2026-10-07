import type { Editor, JSONContent } from "@tiptap/core"
import { Collaboration } from "@tiptap/extension-collaboration"
import { Placeholder } from "@tiptap/extensions"
import { Markdown } from "@tiptap/markdown"
import type { Node as PMNode } from "@tiptap/pm/model"
import type { EditorView } from "@tiptap/pm/view"
import { EditorContent, ReactNodeViewRenderer, useEditor, useEditorState } from "@tiptap/react"
import { RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { ErrorBoundary, type FallbackProps } from "react-error-boundary"
import { toast } from "sonner"
import { DexieYProvider } from "y-dexie"
import type * as Y from "yjs"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { addNoteBlobs, type ClipInput, saveNoteSnapshot } from "@/db/actions"
import { type Clip, NOTE_MEDIA_NODES, noteDoc, type TextClip } from "@/db/schema"
import { readTransfer } from "@/lib/clipboard"
import { detectLanguage } from "@/lib/code"
import { classifyText } from "@/lib/detect"
import { clipLabel, formatAgo } from "@/lib/format"
import { imageSize } from "@/lib/media"
import { Attachment, NOTE_TEXT_EXTENSIONS, NOTE_TEXT_OPTIONS, NoteImage } from "@/lib/note-content"
import { adoptPastedMedia, needsAdoption } from "@/lib/note-media"
import { type EditPoint, onEditRequest } from "@/lib/ui-events"
import { cn } from "@/lib/utils"
import { acceptInserts, setSaving } from "@/state/notes"
import { AttachmentView, ImageView } from "./note-nodes"

/** The note's media nodes, drawn as React views in the editor. Headless rendering uses the plain schema. */
const NOTE_NODE_VIEWS = [
  NoteImage.extend({ addNodeView: () => ReactNodeViewRenderer(ImageView) }),
  Attachment.extend({ addNodeView: () => ReactNodeViewRenderer(AttachmentView) }),
]

export interface NoteEditorProps {
  clip: TextClip
  /** Write mode: a wide centred column, focused on open, with hints while blank. */
  page?: boolean
  readOnly?: boolean
  /** The note ↑ continues from a blank page. */
  previous?: Clip
  onContinue?: () => void
}

/** Keeps a released document alive this long, so a quick remount (StrictMode, switching back) reuses it. */
const RELEASE_GRACE_MS = 1000

export default function NoteEditor(props: NoteEditorProps) {
  return (
    <ErrorBoundary FallbackComponent={EditorCrashed} resetKeys={[props.clip.id]}>
      <DocumentLoader {...props} />
    </ErrorBoundary>
  )
}

/** Whatever broke, the note's content is safe in its stored document; a retry rebuilds the editor from it. */
function EditorCrashed({ resetErrorBoundary }: FallbackProps) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center text-detail text-muted-foreground">
      The editor hit a problem. Your note is saved.
      <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
        <RotateCcw /> Reopen note
      </Button>
    </div>
  )
}

/**
 * Loads the note's document before the editor binds to it, so an empty editor never writes over stored content.
 * The document is acquired and released in one effect: holding it from render can let y-dexie destroy it
 * under a mounted editor.
 */
function DocumentLoader(props: NoteEditorProps) {
  const id = props.clip.id
  const [doc, setDoc] = useState<Y.Doc | null>(null)

  useEffect(() => {
    const loading = noteDoc(id)
    const provider = DexieYProvider.load(loading, { gracePeriod: RELEASE_GRACE_MS })
    let alive = true
    // y-dexie destroys the document when its row is deleted (e.g. from another tab).
    const onDestroy = () => alive && setDoc(null)
    loading.on("destroy", onDestroy)
    provider.whenLoaded.then(
      () => alive && setDoc(loading),
      () => {},
    )
    return () => {
      alive = false
      loading.off("destroy", onDestroy)
      setDoc(null)
      DexieYProvider.release(loading)
    }
  }, [id])

  if (!doc) return null
  return <LoadedEditor key={id} doc={doc} {...props} />
}

/** Snapshots trail typing by this much; the document itself is saved on every keystroke. */
const SNAPSHOT_DELAY_MS = 300

type TextInput = Extract<ClipInput, { type: "text" }>

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

function inCodeBlock(editor: Editor): boolean {
  return editor.state.selection.$from.parent.type.name === "codeBlock"
}

/** After an image or file is put in at the very end, adds a line to keep typing on and moves the caret there. */
function continueAfterMedia(editor: Editor) {
  const { doc, selection } = editor.state
  const last = doc.lastChild
  if (!last || !NOTE_MEDIA_NODES.has(last.type.name) || selection.from < doc.content.size - last.nodeSize) return
  editor.chain().insertContentAt(editor.state.doc.content.size, { type: "paragraph" }).focus("end").run()
}

/** Pastes code as a code block and moves the caret to the line after it, so the next paste isn't swallowed by it. */
function insertCode(editor: Editor, text: string, language: string): boolean {
  const block: JSONContent = { type: "codeBlock", attrs: { language }, content: text ? [{ type: "text", text }] : [] }
  editor.chain().focus().insertContent(block).run()
  const { $from } = editor.state.selection
  if ($from.parent.type.name !== "codeBlock") return true
  const after = $from.after()
  const chain = editor.chain()
  if (!editor.state.doc.resolve(after).nodeAfter?.isTextblock) chain.insertContentAt(after, { type: "paragraph" })
  chain.setTextSelection(after + 1).run()
  return true
}

function LoadedEditor({ doc, clip, page, readOnly, previous, onContinue }: NoteEditorProps & { doc: Y.Doc }) {
  // Editor callbacks are bound once; read the latest props through this.
  const latest = useRef({ clip, previous, onContinue })
  latest.current = { clip, previous, onContinue }
  const editorRef = useRef<Editor | null>(null)
  /** Set while handing a paste back to ProseMirror, so it isn't intercepted a second time. */
  const bypass = useRef(false)

  /** ProseMirror's own paste: HTML keeps its formatting, plain text becomes paragraphs. */
  const pasteNatively = (view: EditorView, input: TextInput) => {
    bypass.current = true
    try {
      if (input.html) view.pasteHTML(input.html)
      else view.pasteText(input.text)
    } finally {
      bypass.current = false
    }
  }

  /** Stores files with the note and puts them in: images inline, anything else as a file chip. */
  const insertFiles = async (files: File[], pos?: number) => {
    const noteId = latest.current.clip.id
    try {
      const [ids, sizes] = await Promise.all([
        addNoteBlobs(noteId, files),
        Promise.all(files.map((file) => (file.type.startsWith("image/") ? imageSize(file) : Promise.resolve({})))),
      ])
      const nodes: JSONContent[] = files.map((file, i) =>
        file.type.startsWith("image/")
          ? { type: "image", attrs: { blob: ids[i], alt: "", ...sizes[i] } }
          : { type: "attachment", attrs: { blob: ids[i], name: file.name || "File", mime: file.type, size: file.size } },
      )
      const editor = editorRef.current
      if (!editor || editor.isDestroyed) return
      const chain = editor.chain().focus()
      ;(pos === undefined ? chain.insertContent(nodes) : chain.insertContentAt(pos, nodes)).run()
      continueAfterMedia(editor)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the file")
    }
  }

  /**
   * Pastes text the way it reads best in a note: code as a code block, markdown as formatting, images
   * inside pasted HTML stored with the note. Returns false to leave it to ProseMirror's own paste.
   */
  const pasteText = (input: TextInput): boolean => {
    const editor = editorRef.current
    if (!editor || inCodeBlock(editor)) return false
    if (input.language) return insertCode(editor, input.text, input.language)
    if (input.html) {
      if (!needsAdoption(input.html)) return false
      const noteId = latest.current.clip.id
      void adoptPastedMedia(noteId, input.html).then(
        (html) => editorRef.current && pasteNatively(editorRef.current.view, { ...input, html }),
        () => editorRef.current && pasteNatively(editorRef.current.view, { type: "text", text: input.text }),
      )
      return true
    }

    const multiline = input.text.trim().includes("\n")
    const kind = classifyText(input.text)
    if (kind === "markdown") return editor.chain().focus().insertContent(input.text, { contentType: "markdown" }).run()
    if (kind === "json" && multiline) return insertCode(editor, input.text, "json")
    if (kind !== "code" || !multiline) return false
    // "code" is only a hint; real detection can still decide it's prose.
    void (async () => {
      const { language, isProse } = await detectLanguage(input.text)
      const current = editorRef.current
      if (!current || current.isDestroyed) return
      if (isProse) pasteNatively(current.view, input)
      else insertCode(current, input.text, language)
    })()
    return true
  }

  /** Content pasted or dropped somewhere around the editor: it goes in at the caret. */
  const insert = (inputs: ClipInput[]) => {
    const editor = editorRef.current
    if (!editor || editor.isDestroyed) return
    editor.commands.focus()
    const files = inputs.flatMap((input) => (input.type === "file" ? [input.file] : []))
    if (files.length) return void insertFiles(files)
    for (const input of inputs) if (input.type === "text" && !pasteText(input)) pasteNatively(editor.view, input)
  }

  const editor = useEditor({
    extensions: [
      ...NOTE_TEXT_EXTENSIONS,
      ...NOTE_NODE_VIEWS,
      Markdown,
      Placeholder.configure({ placeholder: page ? "Start writing, or paste anything…" : "Write something…" }),
      Collaboration.configure({ document: doc }),
    ],
    editable: !readOnly,
    autofocus: page && !readOnly ? "end" : false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        class: cn(
          "note-content prose min-h-full max-w-none outline-none dark:prose-invert",
          "prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-primary prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted prose-pre:text-foreground",
          page ? "text-title leading-[1.7]" : "px-5 py-5 text-title leading-[1.65]",
        ),
        "aria-label": "Note",
      },
      handlePaste: (_view, event) => {
        if (bypass.current || !event.clipboardData) return false
        const inputs = readTransfer(event.clipboardData)
        const files = inputs.flatMap((input) => (input.type === "file" ? [input.file] : []))
        if (files.length) {
          void insertFiles(files)
          return true
        }
        const [input] = inputs
        return input?.type === "text" ? pasteText(input) : false
      },
      // Files dropped from outside go in where they land; text and moves within the note are ProseMirror's.
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !event.dataTransfer?.files.length) return false
        const files = readTransfer(event.dataTransfer).flatMap((input) => (input.type === "file" ? [input.file] : []))
        if (!files.length) return false
        void insertFiles(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos)
        return true
      },
      handleKeyDown: (view, event) => {
        if (event.key === "Escape") {
          view.dom.blur()
          return true
        }
        const { previous: prev, onContinue: next } = latest.current
        if (event.key === "ArrowUp" && !event.shiftKey && !event.metaKey && !event.altKey && prev && next && isBlank(view)) {
          next()
          return true
        }
        return false
      },
    },
  })
  editorRef.current = editor

  /** Writes the note's text and HTML snapshot if it differs from the stored one. */
  const reconcile = async () => {
    if (!editor || readOnly) return
    const content = docHasContent(editor.state.doc)
    const text = content ? editor.getText(NOTE_TEXT_OPTIONS).trimEnd() : ""
    const html = content ? editor.getHTML() : ""
    const { clip: current } = latest.current
    if (text !== current.text || html !== (current.html ?? "")) await saveNoteSnapshot(current.id, text, html)
  }

  // Lists, search and copy read the snapshot. Only this tab's own edits write it, so tabs don't echo each other.
  useEffect(() => {
    if (!editor) return
    const id = latest.current.clip.id
    let timer: ReturnType<typeof setTimeout> | undefined
    const write = () => {
      timer = undefined
      void reconcile().finally(() => timer === undefined && setSaving(id, false))
    }
    const onUpdate = (_update: Uint8Array, _origin: unknown, _doc: Y.Doc, transaction: Y.Transaction) => {
      if (!transaction.local) return
      setSaving(id, true)
      clearTimeout(timer)
      timer = setTimeout(write, SNAPSHOT_DELAY_MS)
    }
    const flush = () => {
      if (timer === undefined) return
      clearTimeout(timer)
      write()
    }
    // The snapshot can trail the document (a tab closed mid-word); bring it up to date on open.
    void reconcile()
    doc.on("updateV2", onUpdate)
    window.addEventListener("pagehide", flush)
    return () => {
      doc.off("updateV2", onUpdate)
      window.removeEventListener("pagehide", flush)
      flush()
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `reconcile` reads the latest props through a ref.
  }, [editor, doc])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  // Clicks on the page around the text, and E, put the caret in the note.
  useEffect(
    () =>
      onEditRequest((point?: EditPoint) => {
        if (!editor || editor.isDestroyed || readOnly) return
        const rect = editor.view.dom.getBoundingClientRect()
        if (!point || point.y > rect.bottom) return void editor.commands.focus("end")
        const hit = editor.view.posAtCoords({
          left: clamp(point.x, rect.left + 1, rect.right - 1),
          top: clamp(point.y, rect.top + 1, rect.bottom - 1),
        })
        editor.commands.focus(hit?.pos ?? "end")
      }),
    [editor, readOnly],
  )

  // In Write, pastes and drops anywhere on the page land in the note.
  const id = clip.id
  useEffect(() => {
    if (!page || readOnly || !editor) return
    return acceptInserts(id, insert)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `insert` reads the editor through a ref.
  }, [page, readOnly, editor, id])

  const blank = useEditorState({ editor, selector: ({ editor: e }) => (e ? !docHasContent(e.state.doc) : true) })

  if (!page) return <EditorContent editor={editor} className="min-h-full" />

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[42.5rem] flex-col px-8 pt-12 pb-[30vh]">
      <EditorContent editor={editor} className="min-h-full" />
      {blank && !readOnly && <BlankHints previous={previous} onContinue={onContinue} />}
    </div>
  )
}

/** `hasContent` on the live document, stopping at the first thing found; it runs on every transaction. */
function docHasContent(doc: PMNode): boolean {
  let found = false
  doc.descendants((node) => {
    if (found) return false
    found = NOTE_MEDIA_NODES.has(node.type.name) || (node.isText && /\S/.test(node.text ?? ""))
    return !found
  })
  return found
}

function isBlank(view: EditorView): boolean {
  const { doc } = view.state
  return doc.childCount <= 1 && doc.textContent.trim() === "" && !doc.firstChild?.isAtom
}

function BlankHints({ previous, onContinue }: { previous?: Clip; onContinue?: () => void }) {
  return (
    <div className="mt-8 flex flex-col gap-2.5 text-detail text-subtle">
      {previous && onContinue && (
        <button
          type="button"
          onClick={onContinue}
          className="-mx-2 flex w-fit max-w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent hover:text-foreground"
        >
          <Kbd>↑</Kbd>
          <span className="truncate">
            Continue “{clipLabel(previous)}”<span className="text-faint"> · {formatAgo(previous.updatedAt)}</span>
          </span>
        </button>
      )}
      <span className="flex items-center gap-2">
        <Kbd>⌘V</Kbd> Paste text, images or files straight into the note
      </span>
    </div>
  )
}
