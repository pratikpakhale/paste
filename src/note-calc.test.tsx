import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Editor } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { db, docUpdates, type TextClip } from "@/db/schema"
import { getRoute, navigate } from "@/state/route"
import { useSettings } from "@/state/settings"
import { useUi } from "@/state/ui"
import { Root } from "./root"

/** Notes that calculate, driven through the editor like a user would. */

const initialUi = useUi.getState()

beforeEach(async () => {
  await Promise.all([db.clips.clear(), db.spaces.clear(), db.blobs.clear(), docUpdates().clear()])
  useUi.setState(initialUi, true)
  // Tests don't reach the network; currencies they use stay in one currency.
  useSettings.setState({ currencyRates: false, numberFormat: "international", autoAnswers: true })
  navigate({ view: { type: "write" }, note: null }, { replace: true })
})
// Leave the shared UI store as found: other test files take their starting state from it.
afterEach(() => {
  cleanup()
  useUi.setState(initialUi, true)
})

type EditorElement = HTMLElement & { editor: Editor }

async function open(): Promise<{ id: string; editor: Editor }> {
  render(<Root />)
  const el = (await screen.findByLabelText("Note", {}, { timeout: 3000 })) as EditorElement
  return { id: getRoute().note!, editor: el.editor }
}

const answers = () => [...document.querySelectorAll(".calc-answer")].map((el) => el.textContent)
const ghosts = () => [...document.querySelectorAll(".calc-ghost")].map((el) => el.textContent)
const calcLines = (editor: Editor) => {
  const lines: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.type.name === "calcLine") lines.push(node.textContent)
    return node.type.name !== "calcLine"
  })
  return lines
}

function key(editor: Editor, name: string, init: KeyboardEventInit = {}) {
  act(() => void fireEvent.keyDown(editor.view.dom, { key: name, ...init }))
}

function paste(target: EventTarget, text: string) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  const data = { "text/plain": text }
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], types: Object.keys(data), getData: (type: string) => data[type as keyof typeof data] ?? "" },
  })
  act(() => void target.dispatchEvent(event))
}

describe("calculations in notes", () => {
  test("a calc block answers each line beside it, and the answers aren't stored", async () => {
    const { id, editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["monthly rent = 2,100", "Monthly Rent * 12", "20% of 85"]).run())
    await waitFor(() => expect(answers()).toEqual(["2,100", "25,200", "17"]), { timeout: 3000 })
    await waitFor(async () =>
      expect(((await db.clips.get(id)) as TextClip).text).toBe("monthly rent = 2,100\nMonthly Rent * 12\n20% of 85"),
    )
  })

  test("sum adds up the run of lines above it", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["Rent: 2100", "Food: 450.50", "sum"]).run())
    await waitFor(() => expect(answers()).toEqual(["2,100", "450.5", "2,550.5"]), { timeout: 3000 })
  })

  test("a line with a problem says what's wrong once the caret leaves it", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["2 + bananas", "3"]).run())
    // The caret is on that line: still being typed, so no error yet.
    await waitFor(() => expect(answers()).toEqual(["3"]), { timeout: 3000 })
    expect(document.querySelector(".calc-error")).toBeNull()
    act(() => void editor.commands.focus("end"))
    await waitFor(() => expect(document.querySelector(".calc-error")?.textContent).toMatch(/bananas/i))
  })

  test("a paragraph ending in = shows its answer, and Tab writes it in", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("Tip on the bill: 15% of 80 =").run())
    await waitFor(() => expect(ghosts()).toEqual(["12"]), { timeout: 3000 })
    key(editor, "Tab")
    await waitFor(() => expect(editor.getText()).toBe("Tip on the bill: 15% of 80 = 12"))
    expect(ghosts()).toEqual([])
  })

  test("a line that is a calculation answers by itself, and Tab writes = and the answer", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("1.5 l in ml").run())
    await waitFor(() => expect(ghosts()).toEqual(["= 1,500 ml"]), { timeout: 3000 })
    key(editor, "Tab")
    await waitFor(() => expect(editor.getText()).toBe("1.5 l in ml = 1,500 ml"))
    expect(ghosts()).toEqual([])
  })

  test("with automatic answers off, only lines ending in = answer", async () => {
    useSettings.setState({ autoAnswers: false })
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("20% of 85").run())
    act(() => void editor.chain().insertCalcBlock(["1 + 1"]).run())
    await waitFor(() => expect(answers()).toEqual(["2"]), { timeout: 3000 })
    expect(ghosts()).toEqual([])
    act(() => void useSettings.setState({ autoAnswers: true }))
    await waitFor(() => expect(ghosts()).toEqual(["= 17"]))
  })

  test("prose without = is left alone", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("Meet at 10:30 with 2 friends").run())
    act(
      () =>
        void editor
          .chain()
          .insertContent([{ type: "paragraph", content: [{ type: "text", text: "It takes 2-3 days" }] }])
          .run(),
    )
    act(
      () =>
        void editor
          .chain()
          .insertContent([{ type: "paragraph", content: [{ type: "text", text: "2024" }] }])
          .run(),
    )
    act(() => void editor.chain().insertCalcBlock(["1 + 1"]).run())
    await waitFor(() => expect(answers()).toEqual(["2"]), { timeout: 3000 })
    expect(ghosts()).toEqual([])
    expect(document.querySelector(".calc-error")).toBeNull()
  })

  test("names flow from prose into a calc block below", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("budget = 1,200").run())
    act(() => void editor.chain().insertCalcBlock(["budget / 4"]).run())
    await waitFor(() => expect(answers()).toEqual(["300"]), { timeout: 3000 })
  })

  test("Return makes a new line, and Return on an empty last line leaves the block", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["1 + 1"]).run())
    act(() => void editor.commands.setTextSelection(editor.state.selection.$from.end()))
    key(editor, "Enter")
    expect(calcLines(editor)).toEqual(["1 + 1", ""])
    key(editor, "Enter")
    expect(calcLines(editor)).toEqual(["1 + 1"])
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph")
  })

  test("pasting several lines into a calculation makes one line each", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock().run())
    paste(editor.view.dom, "4\n5\nsum")
    expect(calcLines(editor)).toEqual(["4", "5", "sum"])
    await waitFor(() => expect(answers()).toEqual(["4", "5", "9"]), { timeout: 3000 })
  })

  test("a ```calc code block, as pasted markdown makes, becomes a calc block", async () => {
    const { editor } = await open()
    act(
      () =>
        void editor
          .chain()
          .focus()
          .insertContent({ type: "codeBlock", attrs: { language: "calc" }, content: [{ type: "text", text: "6 * 7" }] })
          .run(),
    )
    expect(calcLines(editor)).toEqual(["6 * 7"])
    await waitFor(() => expect(answers()).toEqual(["42"]), { timeout: 3000 })
  })

  test("selecting lines shows their sum in the footer", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["10", "20", "30"]).run())
    await waitFor(() => expect(answers()).toHaveLength(3), { timeout: 3000 })
    act(() => {
      // From inside the first line to the end of the last.
      const { doc } = editor.state
      const block = doc.firstChild!
      editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(doc, 2, block.nodeSize - 2)))
    })
    await waitFor(() => expect(screen.getByText(/Σ 60/)).toBeTruthy())
  })

  test("@ picks another line's answer, and the reference follows that line", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus().insertCalcBlock(["Rent: 100", "Food: 40"]).run())
    act(() => void editor.commands.focus("end"))
    await waitFor(() => expect(answers()).toEqual(["100", "40"]), { timeout: 3000 })
    // A third line, then pick "Rent" with the keyboard.
    act(
      () =>
        void editor
          .chain()
          .focus()
          .setTextSelection(editor.state.doc.firstChild!.nodeSize - 2)
          .run(),
    )
    key(editor, "Enter")
    act(() => void editor.chain().insertContent("@ren").run())
    await waitFor(() => expect(screen.getByRole("option", { name: /Rent/ })).toBeTruthy())
    key(editor, "Enter")
    act(() => void editor.chain().insertContent("* 2").run())
    act(() => void editor.commands.focus("end"))
    await waitFor(() => expect(answers()).toEqual(["100", "40", "200"]))
    expect(document.querySelector(".calc-ref")?.textContent).toBe("100")
    // Editing the line it points at changes the answer through the reference.
    act(() => void editor.chain().setTextSelection(10).insertContent("0").run())
    act(() => void editor.commands.focus("end"))
    await waitFor(() => expect(answers()).toEqual(["1,000", "40", "2,000"]))
  })

  test("/ opens a block menu that can add a calculation", async () => {
    const { editor } = await open()
    act(() => void editor.chain().focus("end").insertContent("/calc").run())
    await waitFor(() => expect(screen.getByRole("option", { name: /Calculation/ })).toBeTruthy())
    key(editor, "Enter")
    await waitFor(() => expect(editor.state.doc.firstChild?.type.name).toBe("calcBlock"))
    expect(editor.getText()).not.toContain("/calc")
  })

  test("the command palette works out what's typed into it", async () => {
    await open()
    act(() => useUi.getState().setOverlay("palette"))
    const input = await screen.findByPlaceholderText(/Search clips/)
    act(() => void fireEvent.change(input, { target: { value: "1.5 l in ml" } }))
    await waitFor(() => expect(screen.getByRole("option", { name: /1,500 mL/i })).toBeTruthy(), { timeout: 3000 })
  })
})
