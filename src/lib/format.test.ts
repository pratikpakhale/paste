import { describe, expect, test } from "bun:test"
import { extensionStart, formatAgoShort, resolveFileName } from "./format"

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

describe("formatAgoShort", () => {
  const now = Date.UTC(2026, 9, 7, 12)
  test.each([
    [10_000, "now"],
    [31 * 60_000, "31m"],
    [5 * 3_600_000 + 59 * 60_000, "5h"],
    [3 * 86_400_000, "3d"],
  ])("%p ms ago is %p", (ago, label) => expect(formatAgoShort(now - ago, now)).toBe(label))
  test("older than a week shows the date", () => {
    expect(formatAgoShort(now - 30 * 86_400_000, now)).not.toMatch(/^\d+[mhd]$/)
  })
})
