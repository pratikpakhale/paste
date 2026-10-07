import { beforeEach, describe, expect, test } from "bun:test"
import * as Y from "yjs"
import { exportArchive, importArchive } from "@/lib/archive"
import { renderNote } from "@/lib/note-content"
import { addNoteBlobs, claimNoteBlobs, createNote, deleteForever, isNoteEmpty, readNoteDoc, saveNoteSnapshot, sweepNotes } from "./actions"
import { db, docUpdates, NOTE_FIELD, type TextClip } from "./schema"

/** Writes a paragraph into a note's stored document, as an editor in some tab would have. */
async function writeDoc(id: string, text: string) {
  const doc = new Y.Doc()
  const paragraph = new Y.XmlElement("paragraph")
  paragraph.insert(0, [new Y.XmlText(text)])
  doc.getXmlFragment(NOTE_FIELD).insert(0, [paragraph])
  await docUpdates().add({ k: id, u: Y.encodeStateAsUpdateV2(doc), f: 1 })
}

const note = async (id: string) => (await db.clips.get(id)) as TextClip | undefined

/** Past any grace period the sweep gives notes another tab may have just created. */
const later = () => Date.now() + 2 * 24 * 60 * 60 * 1000

beforeEach(async () => {
  await Promise.all([db.clips.clear(), db.spaces.clear(), db.blobs.clear(), docUpdates().clear()])
})

describe("notes", () => {
  test("a new note is empty and blank", async () => {
    const id = await createNote(null)
    const clip = await note(id)
    expect(clip?.kind).toBe("note")
    expect(clip?.text).toBe("")
    expect(await isNoteEmpty(clip!)).toBe(true)
  })

  test("emptiness is decided by the document, not the snapshot", async () => {
    const id = await createNote(null)
    await writeDoc(id, "   ")
    expect(await isNoteEmpty((await note(id))!)).toBe(true)
    await writeDoc(id, "written before the tab closed")
    expect(await isNoteEmpty((await note(id))!)).toBe(false)
  })

  test("the sweep removes blank notes with their updates and rebuilds lost snapshots", async () => {
    const blank = await createNote(null)
    await writeDoc(blank, "")
    const unsaved = await createNote(null)
    await writeDoc(unsaved, "Call the bank")

    // Too new to be sure no tab is about to start writing in it.
    await sweepNotes()
    expect(await note(blank)).toBeDefined()

    await sweepNotes(later())

    expect(await note(blank)).toBeUndefined()
    expect(await docUpdates().where("k").equals(blank).count()).toBe(0)
    const healed = await note(unsaved)
    expect(healed?.text).toBe("Call the bank")
    expect(healed?.html).toBe("<p>Call the bank</p>")
  })

  test("deleting a note deletes its document", async () => {
    const id = await createNote(null)
    await writeDoc(id, "gone")
    await deleteForever([id])
    expect(await docUpdates().where("k").equals(id).count()).toBe(0)
  })

  test("backups carry a note's document", async () => {
    const id = await createNote(null)
    await writeDoc(id, "Keep me")
    await saveNoteSnapshot(id, "Keep me", "<p>Keep me</p>")
    const archive = await exportArchive()

    await deleteForever([id])
    await importArchive(archive)

    expect((await note(id))?.text).toBe("Keep me")
    expect(renderNote(await readNoteDoc(id)).text).toBe("Keep me")
  })

  test("a note with only an image is not empty", async () => {
    const id = await createNote(null)
    const doc = new Y.Doc()
    doc.getXmlFragment(NOTE_FIELD).insert(0, [new Y.XmlElement("image")])
    await docUpdates().add({ k: id, u: Y.encodeStateAsUpdateV2(doc), f: 1 })
    expect(await isNoteEmpty((await note(id))!)).toBe(false)
    await sweepNotes(later())
    expect(await note(id)).toBeDefined()
  })

  test("a note's images go with it, unless another note shares them", async () => {
    const a = await createNote(null)
    const b = await createNote(null)
    const [own, shared] = await addNoteBlobs(a, [new Blob(["own"]), new Blob(["shared"])])
    expect(await claimNoteBlobs(b, [shared!, "missing"])).toEqual([shared!])

    await deleteForever([a])
    expect(await db.blobs.get(own!)).toBeUndefined()
    expect(await db.blobs.get(shared!)).toBeDefined()
    await deleteForever([b])
    expect(await db.blobs.get(shared!)).toBeUndefined()
  })

  test("blobs can't be added to a note that is gone", async () => {
    const id = await createNote(null)
    await deleteForever([id])
    expect(addNoteBlobs(id, [new Blob(["x"])])).rejects.toThrow("This note was deleted")
    expect(await db.blobs.count()).toBe(0)
  })

  test("backups carry a note's images with their type", async () => {
    const id = await createNote(null)
    const [blob] = await addNoteBlobs(id, [new Blob(["png"], { type: "image/png" })])
    await saveNoteSnapshot(id, "", `<img data-blob="${blob}">`)
    const archive = await exportArchive()
    await deleteForever([id])
    expect(await db.blobs.count()).toBe(0)

    await importArchive(archive)
    expect((await note(id))?.blobs).toEqual([blob!])
    expect((await db.blobs.get(blob!))?.blob.type).toBe("image/png")
  })
})
