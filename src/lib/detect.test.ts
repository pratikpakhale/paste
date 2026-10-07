import { describe, expect, test } from "bun:test"
import { classifyMime, classifyText, classifyTextFile, isColor, isJson, isUrl, MAX_TEXT_FILE_BYTES } from "./detect"

describe("isColor", () => {
  test.each([
    "#fff",
    "#FFFA",
    "#e0a43c",
    "#e0a43c80",
    "rgb(1 2 3)",
    "rgba(0,0,0,.5)",
    "hsl(200 50% 40%)",
    "oklch(0.6 0.2 280)",
    "  #abc  ",
  ])("%p is a color", (value) => expect(isColor(value)).toBe(true))
  test.each(["#ff", "#ggg", "fff", "rgb(1 2 3) red", "color: #fff"])("%p is not a color", (value) => expect(isColor(value)).toBe(false))
})

describe("isUrl", () => {
  test.each(["https://linear.app/changelog", "http://localhost:5173/x?y=1", "mailto:a@b.co", "ftp://host/file"])("%p is a url", (value) =>
    expect(isUrl(value)).toBe(true),
  )
  test.each(["linear.app", "javascript:alert(1)", "see https://a.b", "https://a.b and more"])("%p is not a url", (value) =>
    expect(isUrl(value)).toBe(false),
  )
})

describe("isJson", () => {
  test("objects and arrays", () => {
    expect(isJson('{"a":1}')).toBe(true)
    expect(isJson(" [1, 2, 3] ")).toBe(true)
  })
  test("scalars and invalid input are not treated as json clips", () => {
    expect(isJson("42")).toBe(false)
    expect(isJson('"text"')).toBe(false)
    expect(isJson("{a:1}")).toBe(false)
  })
})

describe("classifyText", () => {
  test("empty text stays text", () => expect(classifyText("   ")).toBe("text"))
  test("specific shapes win over heuristics", () => {
    expect(classifyText("#E0A43C")).toBe("color")
    expect(classifyText("https://example.com")).toBe("link")
    expect(classifyText('{"name":"paste"}')).toBe("json")
  })
  test("markdown", () => {
    expect(classifyText("# Meeting notes\n\n- one\n- two\n\nSee [docs](https://x.y)")).toBe("markdown")
  })
  test("code", () => {
    expect(classifyText('import { a } from "b"\nconst c = () => a()\n')).toBe("code")
    expect(classifyText("def main():\n    return 1 if x else 2\n")).toBe("code")
  })
  test("prose", () => {
    expect(classifyText("Pick up groceries after work, then call mom.")).toBe("text")
  })
})

describe("classifyMime", () => {
  test.each([
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
    ["application/pdf", "pdf"],
    ["application/zip", "file"],
    ["", "file"],
  ] as const)("%p → %p", (mime, kind) => expect(classifyMime(mime)).toBe(kind))
})

describe("classifyTextFile", () => {
  test("source files become code with a language", () => {
    expect(classifyTextFile("app.tsx", "", 100)).toEqual({ kind: "code", language: "tsx" })
    expect(classifyTextFile("Dockerfile", "", 100)).toEqual({ kind: "code", language: "docker" })
  })
  test("markdown, json and plain text", () => {
    expect(classifyTextFile("README.md", "", 10)).toEqual({ kind: "markdown" })
    expect(classifyTextFile("data", "application/json", 10)).toEqual({ kind: "json" })
    expect(classifyTextFile("notes.txt", "text/plain", 10)).toEqual({ kind: "text" })
  })
  test("binary or oversized files stay files", () => {
    expect(classifyTextFile("photo.png", "image/png", 10)).toBeNull()
    expect(classifyTextFile("huge.ts", "", MAX_TEXT_FILE_BYTES + 1)).toBeNull()
  })
})
