import { Dexie, type EntityTable, type Table } from "dexie"
import yDexie, { DexieYProvider, type YUpdateRow } from "y-dexie"
import type * as Y from "yjs"

export const TEXT_KINDS = ["note", "text", "markdown", "code", "json", "link", "color"] as const
export const FILE_KINDS = ["image", "video", "audio", "pdf", "file"] as const

export type TextKind = (typeof TEXT_KINDS)[number]
export type FileKind = (typeof FILE_KINDS)[number]
export type ClipKind = TextKind | FileKind

export interface FileMeta {
  name: string
  mime: string
  size: number
  width?: number
  height?: number
  duration?: number
}

interface ClipBase {
  id: string
  /** `null` means the clip lives outside any space and shows up only in the global views. */
  spaceId: string | null
  /** Empty string means "derive a label from the content". */
  title: string
  /** Fractional index; one global ordering shared by every view so relative order is stable everywhere. */
  order: string
  pinned: boolean
  createdAt: number
  updatedAt: number
  copiedAt: number | null
  deletedAt: number | null
}

export interface TextClip extends ClipBase {
  kind: TextKind
  text: string
  /**
   * The rich source the text was pasted from, kept so copying back preserves formatting.
   * For a note, `text` and `html` are snapshots of its Y.Doc, the note's real content.
   */
  html?: string
  language?: string
  /**
   * Notes only: blobs embedded in the note (images, files). Append-only, since undo or another tab can bring
   * a removed one back; they go when the note is deleted.
   */
  blobs?: string[]
}

export interface FileClip extends ClipBase {
  kind: FileKind
  file: FileMeta
  blobId: string
  thumbId?: string
}

export type Clip = TextClip | FileClip

export interface Space {
  id: string
  name: string
  order: string
  createdAt: number
}

export interface StoredBlob {
  id: string
  blob: Blob
}

export function isFileClip(clip: Clip): clip is FileClip {
  return "blobId" in clip
}

/** A note exists from the moment it's opened, but only counts as a clip once something is in it. */
export function isBlankNote(clip: Clip): boolean {
  return clip.kind === "note" && !isFileClip(clip) && !clip.text.trim() && !clip.html
}

export const db = new Dexie("paste", { addons: [yDexie] }) as Dexie & {
  clips: EntityTable<Clip, "id">
  spaces: EntityTable<Space, "id">
  blobs: EntityTable<StoredBlob, "id">
}

db.version(1).stores({
  clips: "id, order, spaceId, deletedAt",
  spaces: "id, order",
  blobs: "id",
})
// Every clip row gets a Y.Doc; only notes ever write to theirs. y-dexie keeps its updates in `$clips.doc_updates`.
db.version(2).stores({ clips: "id, order, spaceId, deletedAt, doc: Y.Doc" })

/** The update log behind every clip's Y.Doc. Not a real column, so rows must be cleaned up with their clip. */
export const docUpdates = (): Table<YUpdateRow, number, Omit<YUpdateRow, "i">> => db.table("$clips.doc_updates")

/** The Y.XmlFragment in a note's document that Tiptap's Collaboration extension binds to by default. */
export const NOTE_FIELD = "default"

/** Note document nodes that are content on their own, with no text: a note holding just an image isn't blank. */
export const NOTE_MEDIA_NODES: ReadonlySet<string> = new Set(["image", "attachment"])

/** A note's live document. Loading and releasing it is up to the caller (`useDocument`). */
export function noteDoc(id: string): Y.Doc {
  return DexieYProvider.getOrCreateDocument(db, "clips", "doc", id)
}
