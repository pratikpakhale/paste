import { type Extensions, generateHTML, generateText, type JSONContent, mergeAttributes, Node } from "@tiptap/core"
import { Image } from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { StarterKit } from "@tiptap/starter-kit"
import { yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap"
import type * as Y from "yjs"
import { NOTE_FIELD, NOTE_MEDIA_NODES } from "@/db/schema"

/**
 * An image in a note. Pasted and dropped images live in the blob store (`blob`), so the document stays
 * small and every tab can show them; images pasted from the web keep their remote `src`.
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      blob: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-blob"),
        renderHTML: (attrs) => (attrs.blob ? { "data-blob": attrs.blob } : {}),
      },
    }
  },
  parseHTML() {
    // Data URLs are moved into the blob store before a paste reaches the editor; any left over would bloat the document.
    return [{ tag: "img[data-blob]" }, { tag: 'img[src]:not([src^="data:"])' }]
  },
})

/** Any other file in a note, shown as a chip that downloads it. */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      blob: { default: null, parseHTML: (el) => el.getAttribute("data-blob"), renderHTML: (a) => ({ "data-blob": a.blob }) },
      name: {
        default: "File",
        parseHTML: (el) => el.getAttribute("data-name") ?? el.textContent,
        renderHTML: (a) => ({ "data-name": a.name }),
      },
      mime: { default: "", parseHTML: (el) => el.getAttribute("data-mime") ?? "", renderHTML: (a) => ({ "data-mime": a.mime }) },
      size: { default: 0, parseHTML: (el) => Number(el.getAttribute("data-size")) || 0, renderHTML: (a) => ({ "data-size": a.size }) },
    }
  },
  parseHTML() {
    return [{ tag: "div[data-attachment]" }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ["div", mergeAttributes({ "data-attachment": "" }, HTMLAttributes), String(node.attrs.name)]
  },
  renderText({ node }) {
    return String(node.attrs.name)
  },
})

/** A note's text structure. With the media nodes it makes up the schema; the editor draws those with its own views. */
export const NOTE_TEXT_EXTENSIONS: Extensions = [
  // Collaboration brings its own history, scoped to this tab's edits.
  StarterKit.configure({ undoRedo: false, link: { openOnClick: false, autolink: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
]

/** Everything that shapes a note's document. The editor adds behaviour on top; the schema must match. */
export const NOTE_EXTENSIONS: Extensions = [...NOTE_TEXT_EXTENSIONS, NoteImage, Attachment]

/** One line per block, so a note's first line is its title in lists, like every other text clip. */
export const NOTE_TEXT_OPTIONS = { blockSeparator: "\n" }

/** Whether a document has anything worth keeping: visible text, an image or a file. */
export function hasContent(node: JSONContent): boolean {
  if (node.type && NOTE_MEDIA_NODES.has(node.type)) return true
  if (node.text && /\S/.test(node.text)) return true
  return node.content?.some(hasContent) ?? false
}

/** Renders a note's document without an editor, for snapshots written outside one. */
export function renderNote(doc: Y.Doc): { text: string; html: string } {
  const json = yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(NOTE_FIELD))
  if (!hasContent(json)) return { text: "", html: "" }
  return { text: generateText(json, NOTE_EXTENSIONS, NOTE_TEXT_OPTIONS).trimEnd(), html: generateHTML(json, NOTE_EXTENSIONS) }
}
