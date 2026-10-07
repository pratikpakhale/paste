import { detectLanguage } from "@/lib/code"
import { resolveFileName } from "@/lib/format"
import { classifyMime, classifyText, classifyTextFile } from "@/lib/detect"
import { audioInfo, imageInfo, type MediaInfo, videoInfo } from "@/lib/media"
import { keyAtEnd, keysAtTop, type MoveUpdate } from "@/lib/order"
import * as Y from "yjs"
import {
  type Clip,
  db,
  docUpdates,
  type FileClip,
  isBlankNote,
  isFileClip,
  NOTE_FIELD,
  NOTE_MEDIA_NODES,
  type Space,
  type StoredBlob,
  type TextClip,
  type TextKind,
} from "./schema"

export type ClipInput =
  /** `language` is set when the source said what code it is (a code editor's copy). */
  { type: "text"; text: string; html?: string; language?: string } | { type: "file"; file: File }

type Draft =
  | { clip: Omit<TextClip, "id" | "order" | "spaceId" | "createdAt" | "updatedAt">; blobs: [] }
  | { clip: Omit<FileClip, "id" | "order" | "spaceId" | "createdAt" | "updatedAt">; blobs: StoredBlob[] }

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

const base = { pinned: false, copiedAt: null, deletedAt: null } as const

async function refineKind(text: string): Promise<{ kind: TextKind; language?: string }> {
  const kind = classifyText(text)
  if (kind !== "code") return { kind }
  const { language, isProse } = await detectLanguage(text)
  return isProse ? { kind: "text" } : { kind: "code", language }
}

/** Clipboard images arrive as a bare "image.png"; give them a name worth downloading. */
function nameFor(file: File): string {
  if (file.name && !/^image\.(png|jpe?g|gif|webp)$/i.test(file.name)) return file.name
  const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin"
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replaceAll(":", ".")
  return `Pasted ${stamp}.${ext}`
}

async function draft(input: ClipInput): Promise<Draft | null> {
  if (input.type === "text") {
    if (!input.text.trim()) return null
    const { kind, language } = input.language
      ? { kind: input.language === "json" ? ("json" as const) : ("code" as const), language: input.language }
      : await refineKind(input.text)
    return { clip: { ...base, kind, language, title: "", text: input.text, html: input.html }, blobs: [] }
  }

  const { file } = input
  const textFile = classifyTextFile(file.name, file.type, file.size)
  if (textFile) {
    const text = await file.text()
    return { clip: { ...base, ...textFile, title: file.name, text }, blobs: [] }
  }

  const kind = classifyMime(file.type)
  let info: MediaInfo = {}
  if (kind === "image") info = await imageInfo(file)
  else if (kind === "video") info = await videoInfo(file)
  else if (kind === "audio") info = await audioInfo(file)

  const blobId = crypto.randomUUID()
  const blobs: StoredBlob[] = [{ id: blobId, blob: file }]
  let thumbId: string | undefined
  if (info.thumb) {
    thumbId = crypto.randomUUID()
    blobs.push({ id: thumbId, blob: info.thumb })
  }

  return {
    clip: {
      ...base,
      kind,
      title: "",
      blobId,
      thumbId,
      file: {
        name: nameFor(file),
        mime: file.type || "application/octet-stream",
        size: file.size,
        width: info.width,
        height: info.height,
        duration: info.duration,
      },
    },
    blobs,
  }
}

/** Adds clips above everything else, in the order given. Returns the new ids. */
export async function addClips(inputs: ClipInput[], spaceId: string | null): Promise<string[]> {
  const drafts = (await Promise.all(inputs.map(draft))).filter((d) => d !== null)
  if (!drafts.length) return []

  return db.transaction("rw", db.clips, db.blobs, async () => {
    const keys = keysAtTop(await db.clips.toArray(), drafts.length)
    const now = Date.now()
    const clips: Clip[] = drafts.map((d, i) => ({
      ...d.clip,
      id: crypto.randomUUID(),
      order: keys[i]!,
      spaceId,
      createdAt: now,
      updatedAt: now,
    }))
    await db.blobs.bulkAdd(drafts.flatMap((d) => d.blobs))
    await db.clips.bulkAdd(clips)
    return clips.map((c) => c.id)
  })
}

type EditableFields = Pick<TextClip, "text" | "kind" | "language">

export async function updateClip(id: string, changes: Partial<EditableFields>) {
  await db.clips.update(id, { ...changes, updatedAt: Date.now() })
}

/**
 * Renaming a file clip renames the file itself, so downloads, backups and search use the new name.
 * Text clips have no file, so their name is the title.
 */
export async function renameClip(id: string, name: string) {
  await db.clips.update(id, (clip) => {
    if (isFileClip(clip)) {
      clip.file = { ...clip.file, name: resolveFileName(name, clip.file.name) }
      clip.title = ""
    } else clip.title = name.trim()
    clip.updatedAt = Date.now()
  })
}

export async function applyMove(updates: MoveUpdate[]) {
  if (!updates.length) return
  await db.clips.bulkUpdate(updates.map(({ id, order, pinned }) => ({ key: id, changes: { order, pinned } })))
}

export async function setPinned(ids: string[], pinned: boolean) {
  await db.clips.bulkUpdate(ids.map((key) => ({ key, changes: { pinned } })))
}

export async function moveToSpace(ids: string[], spaceId: string | null) {
  await db.clips.bulkUpdate(ids.map((key) => ({ key, changes: { spaceId } })))
}

export async function markCopied(ids: string[]) {
  const copiedAt = Date.now()
  await db.clips.bulkUpdate(ids.map((key) => ({ key, changes: { copiedAt } })))
}

export async function trashClips(ids: string[]) {
  const deletedAt = Date.now()
  await db.clips.bulkUpdate(ids.map((key) => ({ key, changes: { deletedAt, pinned: false } })))
}

export async function restoreClips(ids: string[]) {
  await db.clips.bulkUpdate(ids.map((key) => ({ key, changes: { deletedAt: null } })))
}

async function purge(clips: Clip[]) {
  const ids = clips.map((c) => c.id)
  const gone = new Set(ids)
  await db.transaction("rw", db.clips, db.blobs, docUpdates(), async () => {
    // Re-read inside the transaction: a note may have gained blobs since the caller looked.
    const fresh = (await db.clips.bulkGet(ids)).filter((c) => c !== undefined)
    const fileBlobs = fresh.filter(isFileClip).flatMap((c) => (c.thumbId ? [c.blobId, c.thumbId] : [c.blobId]))
    const noteBlobs = new Set(fresh.flatMap((c) => (isFileClip(c) ? [] : (c.blobs ?? []))))
    if (noteBlobs.size) {
      // An image copied from one note into another is shared, not duplicated; keep it while any note has it.
      await db.clips.each((c) => {
        if (!gone.has(c.id) && !isFileClip(c)) c.blobs?.forEach((id) => noteBlobs.delete(id))
      })
    }
    await db.blobs.bulkDelete([...fileBlobs, ...noteBlobs])
    await db.clips.bulkDelete(ids)
    // y-dexie leaves a deleted row's document updates behind.
    await docUpdates().where("k").anyOf(ids).delete()
  })
}

export async function deleteForever(ids: string[]) {
  const clips = (await db.clips.bulkGet(ids)).filter((c) => c !== undefined)
  await purge(clips)
}

export async function emptyTrash() {
  await purge(await db.clips.where("deletedAt").above(0).toArray())
}

export async function purgeExpiredTrash() {
  await purge(
    await db.clips
      .where("deletedAt")
      .between(1, Date.now() - TRASH_RETENTION_MS)
      .toArray(),
  )
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  return (await db.blobs.get(id))?.blob
}

export async function createSpace(name: string): Promise<string> {
  const space: Space = {
    id: crypto.randomUUID(),
    name: name.trim() || "Untitled",
    order: keyAtEnd(await db.spaces.toArray()),
    createdAt: Date.now(),
  }
  await db.spaces.add(space)
  return space.id
}

export async function renameSpace(id: string, name: string) {
  await db.spaces.update(id, { name: name.trim() || "Untitled" })
}

/** Deleting a space keeps its clips; they fall back to living outside any space. */
export async function deleteSpace(id: string) {
  await db.transaction("rw", db.spaces, db.clips, async () => {
    await db.clips.where("spaceId").equals(id).modify({ spaceId: null })
    await db.spaces.delete(id)
  })
}

export async function reorderSpaces(updates: { id: string; order: string }[]) {
  await db.spaces.bulkUpdate(updates.map(({ id, order }) => ({ key: id, changes: { order } })))
}

/** Creates an empty note at the top. It stays out of every list until it has content. */
export async function createNote(spaceId: string | null): Promise<string> {
  return db.transaction("rw", db.clips, async () => {
    const [order] = keysAtTop(await db.clips.toArray(), 1)
    const now = Date.now()
    const note: TextClip = {
      ...base,
      id: crypto.randomUUID(),
      kind: "note",
      title: "",
      text: "",
      order: order!,
      spaceId,
      createdAt: now,
      updatedAt: now,
    }
    await db.clips.add(note)
    return note.id
  })
}

/** Stores the plain-text and HTML renderings of a note, which lists, search, copy and backups read. */
export async function saveNoteSnapshot(id: string, text: string, html: string) {
  await db.clips.update(id, (clip) => {
    if (isFileClip(clip) || (clip.text === text && clip.html === html)) return
    clip.text = text
    clip.html = html
    clip.updatedAt = Date.now()
  })
}

/** Records blobs as embedded in a note, so they live as long as it does. Fails if the note is gone. */
async function own(noteId: string, blobIds: string[]) {
  const updated = await db.clips.update(noteId, (clip) => {
    if (isFileClip(clip)) return
    clip.blobs = [...new Set([...(clip.blobs ?? []), ...blobIds])]
  })
  if (!updated) throw new Error("This note was deleted")
}

/** Stores files embedded in a note (pasted or dropped images and files). Returns their blob ids, in order. */
export async function addNoteBlobs(noteId: string, blobs: Blob[]): Promise<string[]> {
  const stored = blobs.map((blob) => ({ id: crypto.randomUUID(), blob }))
  await db.transaction("rw", db.clips, db.blobs, async () => {
    await db.blobs.bulkAdd(stored)
    await own(
      noteId,
      stored.map((s) => s.id),
    )
  })
  return stored.map((s) => s.id)
}

/** Lets a note share blobs pasted in from another note. Returns the ones that still exist. */
export async function claimNoteBlobs(noteId: string, blobIds: string[]): Promise<string[]> {
  return db.transaction("rw", db.clips, db.blobs, async () => {
    const found = await db.blobs.bulkGet(blobIds)
    const existing = blobIds.filter((_, i) => found[i])
    if (existing.length) await own(noteId, existing)
    return existing
  })
}

/** A standalone copy of a note's document, read straight from its stored updates. */
export async function readNoteDoc(id: string): Promise<Y.Doc> {
  const doc = new Y.Doc()
  const rows = await docUpdates().where("k").equals(id).toArray()
  Y.transact(doc, () => rows.forEach((row) => Y.applyUpdateV2(doc, row.u)))
  return doc
}

function hasContent(node: Y.XmlElement | Y.XmlText | Y.XmlHook | Y.XmlFragment): boolean {
  if (node instanceof Y.XmlText)
    return node.toDelta().some((op: { insert?: unknown }) => typeof op.insert === "string" && /\S/.test(op.insert))
  if (node instanceof Y.XmlHook) return false
  if (node instanceof Y.XmlElement && NOTE_MEDIA_NODES.has(node.nodeName)) return true
  return node.toArray().some(hasContent)
}

/** Whether a note has nothing worth keeping. Its snapshot can lag its document, so the document decides. */
export async function isNoteEmpty(clip: TextClip): Promise<boolean> {
  if (!isBlankNote(clip)) return false
  if (!(await docUpdates().where("k").equals(clip.id).count())) return true
  return !hasContent((await readNoteDoc(clip.id)).getXmlFragment(NOTE_FIELD))
}

/** Deletes a note that is still empty, unless another tab has it open. */
export async function discardIfEmpty(id: string) {
  const clip = await db.clips.get(id)
  if (!clip || clip.kind !== "note" || isFileClip(clip)) return
  if ((await openNoteIds()).has(id)) return
  if (await isNoteEmpty(clip)) await purge([clip])
}

/** Web Locks, where the browser has them (not over plain http). */
export const locks: LockManager | null = (navigator as Partial<Navigator>).locks ?? null

/** Every tab holds a shared Web Lock named after the note it has open; the browser drops it when the tab dies. */
export const noteLockName = (id: string) => `paste:note:${id}`

/** Notes some tab has open. Empty when the browser has no Web Locks. */
async function openNoteIds(): Promise<Set<string>> {
  if (!locks) return new Set()
  const { held = [] } = await locks.query()
  const prefix = noteLockName("")
  return new Set(held.flatMap((lock) => (lock.name?.startsWith(prefix) ? [lock.name.slice(prefix.length)] : [])))
}

/** Grace for a note another tab has just created but not locked yet. Without Web Locks there's no way to tell, so wait a day. */
const SWEEP_AFTER_MS = locks ? 60_000 : 24 * 60 * 60 * 1000

/**
 * Removes notes that were opened and left blank. A note whose snapshot never got written (its tab was
 * closed mid-word) has its snapshot rebuilt from the document instead.
 */
export async function sweepNotes(now = Date.now()) {
  const notes = (await db.clips.toArray()).filter((c): c is TextClip => isBlankNote(c) && c.createdAt < now - SWEEP_AFTER_MS)
  if (!notes.length) return
  const open = await openNoteIds()
  const closed = notes.filter((note) => !open.has(note.id))
  const empty = await Promise.all(closed.map(isNoteEmpty))
  const unsaved = closed.filter((_, i) => !empty[i])
  if (unsaved.length) {
    const { renderNote } = await import("@/lib/note-content")
    await Promise.all(
      unsaved.map(async (note) => {
        const { text, html } = renderNote(await readNoteDoc(note.id))
        await saveNoteSnapshot(note.id, text, html)
      }),
    )
  }
  await purge(closed.filter((_, i) => empty[i]))
}
