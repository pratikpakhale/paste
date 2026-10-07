import { describe, expect, test } from "bun:test"
import { extensionStart, resolveFileName } from "./format"

describe("extensionStart", () => {
  test.each([
    ["photo.png", 5],
    ["archive.tar.gz", 11],
    ["README", 6],
    [".env", 4],
    ["trailing.", 9],
  ])("%p", (name, index) => expect(extensionStart(name)).toBe(index))
})

describe("resolveFileName", () => {
  test("keeps the old extension when the new name has none", () => {
    expect(resolveFileName("Receipt", "IMG_0142.png")).toBe("Receipt.png")
  })
  test("respects a new extension", () => {
    expect(resolveFileName("notes.md", "notes.txt")).toBe("notes.md")
  })
  test("trims, and an empty name keeps the current one", () => {
    expect(resolveFileName("  Report  ", "q3.pdf")).toBe("Report.pdf")
    expect(resolveFileName("   ", "q3.pdf")).toBe("q3.pdf")
  })
  test("never produces a path", () => {
    expect(resolveFileName("a/b\\c", "x.zip")).toBe("a-b-c.zip")
  })
  test("names without an extension stay without one", () => {
    expect(resolveFileName("Makefile", "build")).toBe("Makefile")
  })
})
