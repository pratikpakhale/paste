import { detectLanguage } from "@/lib/code"
import { classifyMime, classifyText, classifyTextFile } from "@/lib/detect"
import { audioInfo, imageInfo, type MediaInfo, videoInfo } from "@/lib/media"
import { keyAtEnd, keysAtTop, type MoveUpdate } from "@/lib/order"
import { type Clip, db, type FileClip, isFileClip, type Space, type StoredBlob, type TextClip, type TextKind } from "./schema"

export type ClipInput = { type: "text"; text: string; html?: string } | { type: "file"; file: File }

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
    const { kind, language } = await refineKind(input.text)
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

type EditableFields = Pick<TextClip, "title" | "text" | "kind" | "language">

export async function updateClip(id: string, changes: Partial<EditableFields>) {
  await db.clips.update(id, { ...changes, updatedAt: Date.now() })
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
  const blobIds = clips.filter(isFileClip).flatMap((c) => (c.thumbId ? [c.blobId, c.thumbId] : [c.blobId]))
  await db.transaction("rw", db.clips, db.blobs, async () => {
    await db.blobs.bulkDelete(blobIds)
    await db.clips.bulkDelete(clips.map((c) => c.id))
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
