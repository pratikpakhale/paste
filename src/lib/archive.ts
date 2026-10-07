import { strFromU8, strToU8, unzip, type Unzipped } from "fflate"
import { type Clip, db, isFileClip, type Space } from "@/db/schema"
import { zipFiles } from "./clipboard"

const FORMAT = "paste-archive"
const VERSION = 1

interface Manifest {
  format: typeof FORMAT
  version: number
  exportedAt: number
  spaces: Space[]
  clips: Clip[]
}

export async function exportArchive(): Promise<Blob> {
  const [spaces, clips, blobs] = await Promise.all([db.spaces.toArray(), db.clips.toArray(), db.blobs.toArray()])
  const manifest: Manifest = { format: FORMAT, version: VERSION, exportedAt: Date.now(), spaces, clips }
  const files: Record<string, Uint8Array> = { "manifest.json": strToU8(JSON.stringify(manifest)) }
  const buffers = await Promise.all(blobs.map(({ blob }) => blob.arrayBuffer()))
  blobs.forEach(({ id }, i) => (files[`blobs/${id}`] = new Uint8Array(buffers[i]!)))
  return zipFiles(files)
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => unzip(data, (err, out) => (err ? reject(err) : resolve(out))))
}

export interface ImportResult {
  clips: number
  spaces: number
}

/** Merges an archive into the library. Items that already exist (same id) are left untouched. */
export async function importArchive(file: Blob): Promise<ImportResult> {
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()))
  const raw = entries["manifest.json"]
  if (!raw) throw new Error("Not a Paste archive: manifest.json is missing")
  const manifest = JSON.parse(strFromU8(raw)) as Manifest
  if (manifest.format !== FORMAT) throw new Error("Not a Paste archive")
  if (manifest.version > VERSION) throw new Error("This archive was made by a newer version of Paste")

  return db.transaction("rw", db.clips, db.spaces, db.blobs, async () => {
    const existingClips = new Set(await db.clips.toCollection().primaryKeys())
    const existingSpaces = new Set(await db.spaces.toCollection().primaryKeys())
    const spaces = manifest.spaces.filter((s) => !existingSpaces.has(s.id))
    const clips = manifest.clips.filter((c) => !existingClips.has(c.id))

    const blobs = clips.filter(isFileClip).flatMap((clip) => {
      const ids = clip.thumbId ? [clip.blobId, clip.thumbId] : [clip.blobId]
      return ids.flatMap((id) => {
        const data = entries[`blobs/${id}`]
        const type = id === clip.blobId ? clip.file.mime : "image/webp"
        return data ? [{ id, blob: new Blob([data], { type }) }] : []
      })
    })

    await db.spaces.bulkAdd(spaces)
    await db.blobs.bulkPut(blobs)
    await db.clips.bulkAdd(clips)
    return { clips: clips.length, spaces: spaces.length }
  })
}
