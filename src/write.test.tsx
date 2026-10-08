import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Editor, JSONContent } from "@tiptap/core"
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import * as Y from "yjs"
import { addClips, deleteForever, readNoteDoc, restoreClips, saveNoteSnapshot, trashClips } from "@/db/actions"
import { type Clip, db, docUpdates, NOTE_FIELD, type TextClip } from "@/db/schema"
import { getRoute, navigate } from "@/state/route"
import { useUi } from "@/state/ui"
import { Root } from "./root"

/**
 * Write, driven like a user would: every way content arrives in a note, every way of getting to a note,
 * and what other tabs can do to it meanwhile (they share the same database).
 */

const initialUi = useUi.getState()

beforeEach(async () => {
  await Promise.all([db.clips.clear(), db.spaces.clear(), db.blobs.clear(), docUpdates().clear()])
  useUi.setState(initialUi, true)
  navigate({ view: { type: "write" }, note: null }, { replace: true })
})
afterEach(cleanup)

type EditorElement = HTMLElement & { editor: Editor }

/** The open note's editor, once its document has loaded. */
async function noteEditor(): Promise<Editor> {
  const el = (await screen.findByLabelText("Note", {}, { timeout: 3000 })) as EditorElement
  return el.editor
}

/** The editor for a specific note, waiting out a switch from another one. */
async function editorFor(id: string): Promise<Editor> {
  await waitFor(() => expect(getRoute().note).toBe(id))
  let editor: Editor | undefined
  await waitFor(async () => {
    editor = await noteEditor()
    expect(editor.isDestroyed).toBe(false)
  })
  return editor!
}

/** A clipboard as the browser hands it over. */
function clipboard(data: Record<string, string>, files: File[] = []): DataTransfer {
  return {
    files,
    types: [...Object.keys(data), ...(files.length ? ["Files"] : [])],
    getData: (type: string) => data[type] ?? "",
  } as unknown as DataTransfer
}

function paste(target: EventTarget, data: Record<string, string>, files: File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: clipboard(data, files) })
  act(() => void target.dispatchEvent(event))
}

function drop(target: EventTarget, data: Record<string, string>, files: File[] = []) {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: clipboard(data, files) })
  act(() => void target.dispatchEvent(event))
}

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init })
    fireEvent.keyUp(document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init })
  })
}

function typeInto(editor: Editor, text: string) {
  act(() => void editor.chain().focus("end").insertContent(text).run())
}

const png = () => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "image.png", { type: "image/png" })
const pdf = () => new File([new Uint8Array([37, 80, 68, 70])], "Lease.pdf", { type: "application/pdf" })

const note = async (id: string) => (await db.clips.get(id)) as TextClip | undefined
const otherClips = async (noteId: string) => (await db.clips.toArray()).filter((c: Clip) => c.id !== noteId)

function nodesOf(editor: Editor, type: string): JSONContent[] {
  const found: JSONContent[] = []
  const walk = (node: JSONContent) => {
    if (node.type === type) found.push(node)
    node.content?.forEach(walk)
  }
  walk(editor.getJSON())
  return found
}

/** Write's own header, apart from the sidebar's buttons. */
const header = () => document.querySelector("main header")!

/** Opens the app on its blank note and waits for the editor. */
async function open(): Promise<{ id: string; editor: Editor }> {
  render(<Root />)
  const editor = await noteEditor()
  const id = getRoute().note!
  return { id, editor }
}

describe("write", () => {
  test("opens on a blank note that stays out of the lists", async () => {
    const { id } = await open()
    expect(new URL(location.href).searchParams.get("note")).toBe(id)
    expect((await note(id))?.kind).toBe("note")
    expect(header().textContent).toContain("New note")
    expect(screen.getByText(/Saved as you type/)).toBeTruthy()
    act(() => navigate({ view: { type: "all" } }))
    expect((await screen.findAllByText("Paste anything")).length).toBeGreaterThan(0)
  })

  test("typing is stored at once and the snapshot follows", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Groceries")
    // The document itself is written on every change.
    await waitFor(async () => expect(await docUpdates().where("k").equals(id).count()).toBeGreaterThan(0))
    await waitFor(async () => expect((await note(id))?.text).toBe("Groceries"))
    expect(await screen.findByText("Saved")).toBeTruthy()
    expect((await screen.findAllByText("Groceries")).length).toBeGreaterThan(0)
  })

  test("text pasted into the editor goes into the note, a link on a blank page too", async () => {
    const { id, editor } = await open()
    paste(editor.view.dom, { "text/plain": "https://example.com/report" })
    await waitFor(() => expect(editor.getText()).toContain("https://example.com/report"))
    paste(editor.view.dom, { "text/plain": " and more" })
    await waitFor(() => expect(editor.getText()).toContain("and more"))
    expect(await otherClips(id)).toHaveLength(0)
    expect(getRoute().view.type).toBe("write")
  })

  test("a paste on the page around the editor goes into the note", async () => {
    const { id, editor } = await open()
    act(() => editor.view.dom.blur())
    paste(document.body, { "text/plain": "From the margin" })
    await waitFor(() => expect(editor.getText()).toContain("From the margin"))
    await waitFor(async () => expect((await note(id))?.text).toBe("From the margin"))
    expect(await otherClips(id)).toHaveLength(0)
    expect(getRoute().view.type).toBe("write")
  })

  test("a paste made before the note has loaded is not lost", async () => {
    render(<Root />)
    paste(document.body, { "text/plain": "Too quick" })
    const editor = await noteEditor()
    await waitFor(() => expect(editor.getText()).toContain("Too quick"))
    expect(await db.clips.count()).toBe(1)
  })

  test("a pasted image is stored with the note and shown in it", async () => {
    const { id, editor } = await open()
    paste(editor.view.dom, {}, [png()])
    await waitFor(() => expect(nodesOf(editor, "image")).toHaveLength(1), { timeout: 4000 })
    const blob = nodesOf(editor, "image")[0]!.attrs!.blob as string
    expect(await db.blobs.get(blob)).toBeDefined()
    expect((await note(id))?.blobs).toEqual([blob])
    expect(await otherClips(id)).toHaveLength(0)
    // A note holding only an image isn't blank.
    await waitFor(async () => expect((await note(id))?.html).toContain(`data-blob="${blob}"`))
    // The blank note's placeholder title is gone; only the button to start another says "New note".
    expect(within(header() as HTMLElement).queryByText("New note", { selector: "span" })).toBeNull()
    act(() => navigate({ view: { type: "all" } }))
    expect((await screen.findAllByText("Image note")).length).toBeGreaterThan(0)
    expect((await screen.findAllByText("0 words · 1 image")).length).toBeGreaterThan(0)
  }, 10_000)

  test("other files become a file chip in the note", async () => {
    const { id, editor } = await open()
    paste(editor.view.dom, {}, [pdf()])
    await waitFor(() => expect(nodesOf(editor, "attachment")).toHaveLength(1))
    expect(nodesOf(editor, "attachment")[0]!.attrs).toMatchObject({ name: "Lease.pdf", mime: "application/pdf", size: 4 })
    expect(await screen.findByLabelText("Download Lease.pdf")).toBeTruthy()
    await waitFor(async () => expect((await note(id))?.text).toBe("Lease.pdf"))
    expect(await otherClips(id)).toHaveLength(0)
  })

  test("pasted markdown becomes formatting, pasted code a code block", async () => {
    const { editor } = await open()
    paste(editor.view.dom, { "text/plain": "# Plan\n\n- **one**\n- two" })
    await waitFor(() => expect(nodesOf(editor, "heading")).toHaveLength(1))
    expect(nodesOf(editor, "bulletList")).toHaveLength(1)
    expect(nodesOf(editor, "bold")).toHaveLength(0)
    expect(editor.getHTML()).toContain("<strong>one</strong>")

    paste(editor.view.dom, { "text/plain": '{\n  "name": "paste",\n  "private": true\n}' })
    await waitFor(() => expect(nodesOf(editor, "codeBlock")).toHaveLength(1))
    expect(nodesOf(editor, "codeBlock")[0]!.attrs!.language).toBe("json")

    paste(editor.view.dom, { "text/plain": "const a = 1", "vscode-editor-data": '{"mode":"typescriptreact"}' })
    await waitFor(() => expect(nodesOf(editor, "codeBlock")).toHaveLength(2))
    expect(nodesOf(editor, "codeBlock")[1]!.attrs!.language).toBe("tsx")
  })

  test("images inside pasted HTML move into the blob store", async () => {
    const { id, editor } = await open()
    const dataUrl = "data:image/png;base64,iVBORw0KGgo="
    paste(editor.view.dom, { "text/plain": "Look", "text/html": `<p>Look</p><img src="${dataUrl}" alt="chart">` })
    await waitFor(() => expect(nodesOf(editor, "image")).toHaveLength(1))
    const [image] = nodesOf(editor, "image")
    expect(image!.attrs!.src).toBeNull()
    expect((await note(id))?.blobs).toContain(image!.attrs!.blob)
    expect(editor.getText()).toContain("Look")
  })

  test("a new note from mid-sentence keeps the one being written", async () => {
    const { id: first, editor } = await open()
    typeInto(editor, "Draft plan")
    await waitFor(async () => expect((await note(first))?.text).toBe("Draft plan"))

    // From inside the editor, where N would just type.
    act(
      () =>
        void fireEvent.keyDown(editor.view.dom, {
          key: "o",
          code: "KeyO",
          shiftKey: true,
          ...(/mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }),
        }),
    )
    await waitFor(() => expect(getRoute().note).not.toBe(first))
    expect((await note(first))?.text).toBe("Draft plan")
    await editorFor(getRoute().note!)

    // On a blank note the sidebar's Write is where you are; once it's written in, it starts the next one.
    const write = () => screen.getByText(/^(Write|New note)$/, { selector: "nav button span" }).closest("button")!
    expect(write().textContent).toBe("Write")
    typeInto(await noteEditor(), "Second")
    const second = getRoute().note!
    await waitFor(async () => expect((await note(second))?.text).toBe("Second"))
    await waitFor(() => expect(write().textContent).toBe("New note"))
    act(() => void fireEvent.click(write()))
    await waitFor(() => expect(getRoute().note).not.toBe(second))
    expect((await note(second))?.deletedAt).toBeNull()
    await waitFor(() => expect(write().textContent).toBe("Write"))
  })

  test("switching between notes keeps each one editable", async () => {
    const { id: first, editor } = await open()
    typeInto(editor, "First note")
    await waitFor(async () => expect((await note(first))?.text).toBe("First note"))

    act(() => editor.view.dom.blur())
    press("n")
    await waitFor(() => expect(getRoute().note).not.toBe(first))
    const second = getRoute().note!
    typeInto(await editorFor(second), "Second note")
    await waitFor(async () => expect((await note(second))?.text).toBe("Second note"))

    // Back and forth, faster than documents load and release.
    for (const id of [first, second, first, second, first]) act(() => navigate({ note: id }))
    const back = await editorFor(first)
    await waitFor(() => expect(back.getText()).toBe("First note"))
    typeInto(back, " again")
    await waitFor(async () => expect((await note(first))?.text).toBe("First note again"))

    // From Recent notes in the sidebar.
    const recent = (await screen.findAllByText("Second note")).find((el) => el.closest("button"))!
    act(() => void fireEvent.click(recent.closest("button")!))
    const reopened = await editorFor(second)
    await waitFor(() => expect(reopened.getText()).toBe("Second note"))
    expect(screen.queryByText(/hit a problem/)).toBeNull()
  })

  test("a note opened from a list edits in place, and double-click opens it in Write", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Draft")
    await waitFor(async () => expect((await note(id))?.text).toBe("Draft"))

    act(() => navigate({ view: { type: "all" } }))
    act(() => useUi.getState().setSelection([id], id))
    const inPane = await noteEditor()
    await waitFor(() => expect(inPane.getText()).toBe("Draft"))
    typeInto(inPane, " edited")
    await waitFor(async () => expect((await note(id))?.text).toBe("Draft edited"))

    const row = document.querySelector(`[data-clip-id="${id}"]`)!
    act(() => void fireEvent.doubleClick(row))
    expect(getRoute().view.type).toBe("write")
    expect(getRoute().note).toBe(id)
  })

  test("list shortcuts don't touch clips hidden behind Write", async () => {
    const [clipId] = await addClips([{ type: "text", text: "Keep me" }], null)
    const { editor } = await open()
    act(() => useUi.getState().setSelection([clipId!], clipId))
    act(() => editor.view.dom.blur())
    for (const key of ["Backspace", "p", "Enter", "m"]) press(key)
    await new Promise((r) => setTimeout(r, 100))
    const clip = await db.clips.get(clipId!)
    expect(clip?.deletedAt).toBeNull()
    expect(clip?.pinned).toBe(false)
    expect(useUi.getState().overlay).toBeNull()
    expect(getRoute().view.type).toBe("write")
  })

  test("the palette's commands act on the note, not the hidden list", async () => {
    const [clipId] = await addClips([{ type: "text", text: "Keep me" }], null)
    const { id, editor } = await open()
    typeInto(editor, "Palette target")
    await waitFor(async () => expect((await note(id))?.text).toBe("Palette target"))
    act(() => useUi.getState().setSelection([clipId!], clipId))
    press("k", /mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true })
    expect(await screen.findByText("This note")).toBeTruthy()
    expect(screen.getByText("Copy note")).toBeTruthy()
    expect(screen.queryByText("Select all in view")).toBeNull()
    act(() => void fireEvent.click(screen.getByText("Move to trash")))
    await waitFor(async () => expect((await note(id))?.deletedAt).not.toBeNull())
    expect((await db.clips.get(clipId!))?.deletedAt).toBeNull()
    await waitFor(() => expect(getRoute().note).not.toBe(id))
  })

  test("trashing the note moves on to a new one", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Throwaway")
    await waitFor(async () => expect((await note(id))?.text).toBe("Throwaway"))
    act(() => void fireEvent.click(screen.getByLabelText("Move to trash")))
    await waitFor(() => expect(getRoute().note).not.toBe(id))
    expect((await note(id))?.deletedAt).not.toBeNull()
    await noteEditor()
    expect(header().textContent).toContain("New note")
  })

  test("a note trashed in another tab turns read-only and takes no pastes", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Shared")
    await waitFor(async () => expect((await note(id))?.text).toBe("Shared"))
    await trashClips([id])
    expect(await screen.findByText("This note is in the trash.")).toBeTruthy()
    await waitFor(() => expect(editor.isEditable).toBe(false))

    paste(document.body, { "text/plain": "Somewhere else" })
    expect(await screen.findByText("This note is in the trash")).toBeTruthy()
    expect(await otherClips(id)).toHaveLength(0)
    expect(getRoute().view.type).toBe("write")

    await restoreClips([id])
    await waitFor(() => expect(editor.isEditable).toBe(true))
  })

  test("a note deleted in another tab says so", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Doomed")
    await waitFor(async () => expect((await note(id))?.text).toBe("Doomed"))
    await deleteForever([id])
    expect(await screen.findByText("This note was deleted.")).toBeTruthy()
    act(() => void fireEvent.click(screen.getByRole("button", { name: /New note N$/ })))
    await waitFor(() => expect(getRoute().note).not.toBe(id))
    await noteEditor()
  })

  test("a note left blank is discarded", async () => {
    const { id: blank, editor } = await open()
    act(() => editor.view.dom.blur())
    press("n")
    await waitFor(() => expect(getRoute().note).not.toBe(blank))
    await waitFor(async () => expect(await note(blank)).toBeUndefined())
  })

  test("a reload comes back to the same note", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Still here")
    await waitFor(async () => expect((await note(id))?.text).toBe("Still here"))
    cleanup()
    useUi.setState(initialUi, true)
    navigate({ view: { type: "write" }, note: id }, { replace: true })
    render(<Root />)
    const again = await editorFor(id)
    await waitFor(() => expect(again.getText()).toBe("Still here"))
  })

  test("↑ on a blank note continues the last one", async () => {
    const { id: first, editor } = await open()
    typeInto(editor, "Ongoing")
    await waitFor(async () => expect((await note(first))?.text).toBe("Ongoing"))
    act(() => editor.view.dom.blur())
    press("n")
    await waitFor(() => expect(getRoute().note).not.toBe(first))
    const blank = await editorFor(getRoute().note!)
    expect(await screen.findByText(/Continue “Ongoing”/)).toBeTruthy()
    act(() => void fireEvent.keyDown(blank.view.dom, { key: "ArrowUp" }))
    await waitFor(() => expect(getRoute().note).toBe(first))
  })

  test("a file dropped on the page goes into the note", async () => {
    const { id, editor } = await open()
    drop(document.body, {}, [pdf()])
    await waitFor(() => expect(nodesOf(editor, "attachment")).toHaveLength(1))
    expect(await otherClips(id)).toHaveLength(0)
  })

  test("edits made in another tab show up live", async () => {
    const { id, editor } = await open()
    typeInto(editor, "Mine")
    await waitFor(async () => expect((await note(id))?.text).toBe("Mine"))
    // Another tab's edit: an update to the same document, stored in the shared database.
    const theirs = new Y.Doc()
    Y.applyUpdateV2(theirs, Y.encodeStateAsUpdateV2(await readNoteDoc(id)))
    const paragraph = new Y.XmlElement("paragraph")
    paragraph.insert(0, [new Y.XmlText("Theirs")])
    const before = Y.encodeStateVector(theirs)
    theirs.getXmlFragment(NOTE_FIELD).push([paragraph])
    await docUpdates().add({ k: id, u: Y.encodeStateAsUpdateV2(theirs, before), f: 1 })
    await waitFor(() => expect(editor.getText()).toContain("Theirs"), { timeout: 3000 })
    expect(editor.getText()).toContain("Mine")
  })

  test("pastes outside Write still become clips", async () => {
    await open()
    act(() => navigate({ view: { type: "all" } }))
    paste(document.body, { "text/plain": "A clip" })
    await waitFor(async () => expect((await db.clips.toArray()).some((c) => c.kind === "text")).toBe(true))
  })

  test("the snapshot of a note written elsewhere is shown, not overwritten", async () => {
    const { id } = await open()
    await saveNoteSnapshot(id, "Elsewhere", "<p>Elsewhere</p>")
    expect((await note(id))?.text).toBe("Elsewhere")
  })
})
