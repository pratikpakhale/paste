import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { addClips } from "@/db/actions"
import { db } from "@/db/schema"
import { useUi } from "@/state/ui"
import { Root } from "./root"

/** Smoke tests: the real provider tree against an in-memory IndexedDB, driven like a user would. */

const initialUi = useUi.getState()

beforeEach(async () => {
  await Promise.all([db.clips.clear(), db.spaces.clear(), db.blobs.clear()])
  useUi.setState(initialUi, true)
})
afterEach(cleanup)

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    fireEvent.keyDown(document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init })
    fireEvent.keyUp(document.body, { key, code: key.length === 1 ? `Key${key.toUpperCase()}` : key, ...init })
  })
}

function paste(text: string) {
  const data = new DataTransfer()
  data.setData("text/plain", text)
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: data })
  act(() => void document.body.dispatchEvent(event))
}

const liveClips = () => db.clips.filter((c) => c.deletedAt === null).toArray()

describe("app", () => {
  test("mounts empty with the welcome state", async () => {
    render(<Root />)
    expect(await screen.findByText("Paste anything")).toBeTruthy()
    expect(screen.getAllByText("All clips").length).toBeGreaterThan(0)
  })

  test("renders stored clips of every text kind", async () => {
    await addClips(
      [
        { type: "text", text: "Pick up groceries" },
        { type: "text", text: "#e0a43c" },
        { type: "text", text: "https://linear.app/changelog" },
        { type: "text", text: '{"name":"paste"}' },
        { type: "text", text: "# Notes\n\n- one\n- two\n\n[docs](https://x.y)" },
      ],
      null,
    )
    render(<Root />)
    expect(await screen.findByText("Pick up groceries")).toBeTruthy()
    expect(screen.getAllByText(/#e0a43c/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/linear\.app/).length).toBeGreaterThan(0)
  })

  test("a paste outside text fields becomes a new clip at the top", async () => {
    await addClips([{ type: "text", text: "older clip" }], null)
    render(<Root />)
    await screen.findByText("older clip")
    paste("fresh from the clipboard")
    await waitFor(async () => expect((await liveClips()).length).toBe(2))
    // Shown in the list and, being auto-selected, in the detail pane.
    expect((await screen.findAllByText("fresh from the clipboard")).length).toBeGreaterThan(0)
    expect(useUi.getState().selected).toHaveLength(1)
    const [top] = (await db.clips.orderBy("order").toArray()) ?? []
    expect(top?.kind === "text" && top.text).toBe("fresh from the clipboard")
  })

  test("keyboard: select, pin, move and trash", async () => {
    await addClips(
      [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
        { type: "text", text: "third" },
      ],
      null,
    )
    render(<Root />)
    await screen.findByText("first")

    press("j")
    expect(useUi.getState().cursor).not.toBeNull()
    const firstId = useUi.getState().cursor!

    press("p")
    await waitFor(async () => expect((await db.clips.get(firstId))?.pinned).toBe(true))

    press("j")
    const secondId = useUi.getState().cursor!
    expect(secondId).not.toBe(firstId)
    press("ArrowDown", { altKey: true })
    await waitFor(async () => {
      const ordered = (await liveClips()).toSorted((a, b) => (a.order < b.order ? -1 : 1)).map((c) => c.id)
      expect(ordered.indexOf(secondId)).toBeGreaterThan(1)
    })

    press("Backspace")
    await waitFor(async () => expect((await db.clips.get(secondId))?.deletedAt).not.toBeNull())
  })

  test("opens the composer, palette and shortcuts", async () => {
    render(<Root />)
    await screen.findByText("Paste anything")

    press("n")
    expect(await screen.findByPlaceholderText(/Write or paste/)).toBeTruthy()
    act(() => useUi.getState().setOverlay(null))

    // react-hotkeys-hook maps `mod` to ⌘ on macOS and Ctrl elsewhere; happy-dom is not macOS.
    press("k", /mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true })
    expect(await screen.findByPlaceholderText(/Search clips or type a command/)).toBeTruthy()
    act(() => useUi.getState().setOverlay(null))

    press("?", { shiftKey: true, code: "Slash" })
    expect(await screen.findByText("Keyboard shortcuts")).toBeTruthy()
  })

  test("selecting a clip shows it in the detail pane", async () => {
    await addClips([{ type: "text", text: "detail me" }], null)
    render(<Root />)
    await screen.findByText("detail me")
    press("j")
    await waitFor(() => expect(screen.getByDisplayValue("detail me")).toBeTruthy())
  })

  test("renaming a file renames the file and keeps its extension", async () => {
    await addClips([{ type: "file", file: new File(["PK"], "IMG_0142.zip", { type: "application/zip" }) }], null)
    render(<Root />)
    await screen.findAllByText("IMG_0142.zip")
    press("j")
    press("r")
    const input = await screen.findByLabelText<HTMLInputElement>("File name")
    expect(document.activeElement?.getAttribute("aria-label")).toBe("File name")
    // Only the base name is selected, like Finder.
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, "IMG_0142".length])

    fireEvent.change(input, { target: { value: "Receipt" } })
    act(() => input.blur())
    await waitFor(async () => {
      const [clip] = await liveClips()
      expect(clip && "file" in clip && clip.file.name).toBe("Receipt.zip")
    })
    await waitFor(() => expect(screen.getByLabelText<HTMLInputElement>("File name").value).toBe("Receipt.zip"))
  })

  test("rename from the palette keeps focus in the name field after it closes", async () => {
    await addClips([{ type: "text", text: "a note" }], null)
    render(<Root />)
    await screen.findByText("a note")
    press("j")
    press("k", /mac/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true })
    const search = await screen.findByPlaceholderText(/Search clips or type a command/)
    fireEvent.change(search, { target: { value: "rename" } })
    fireEvent.click(await screen.findByText("Rename"))
    // Compare labels, not elements: bun's diff of two DOM nodes on a failed retry crashes the runner.
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Title"))
  })

  test("[ toggles the sidebar", async () => {
    render(<Root />)
    await screen.findByText("Paste anything")
    expect(useUi.getState().sidebarOpen).toBe(true)
    press("[", { code: "BracketLeft" })
    expect(useUi.getState().sidebarOpen).toBe(false)
    expect(await screen.findByLabelText("Show sidebar")).toBeTruthy()
    press("[", { code: "BracketLeft" })
    expect(useUi.getState().sidebarOpen).toBe(true)
  })
})
