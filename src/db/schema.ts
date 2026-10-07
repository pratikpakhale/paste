import { Dexie, type EntityTable } from "dexie"

export const TEXT_KINDS = ["text", "markdown", "code", "json", "link", "color"] as const
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
  /** The rich source the text was pasted from, kept so copying back preserves formatting. */
  html?: string
  language?: string
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

export const db = new Dexie("paste") as Dexie & {
  clips: EntityTable<Clip, "id">
  spaces: EntityTable<Space, "id">
  blobs: EntityTable<StoredBlob, "id">
}

db.version(1).stores({
  clips: "id, order, spaceId, deletedAt",
  spaces: "id, order",
  blobs: "id",
})
