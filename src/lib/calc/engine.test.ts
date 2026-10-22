import { describe, expect, test } from "bun:test"
import { createCalc } from "./engine"
import type { CalcInput, CalcOptions, CalcResult, ExchangeRates } from "./types"

const calc = createCalc()
const US: CalcOptions = { locale: "en-US", now: new Date(2026, 9, 22, 9, 30) }
const RATES: ExchangeRates = { base: "EUR", date: "2026-10-21", rates: { EUR: 1, USD: 1.25, INR: 100, GBP: 0.8, JPY: 160 } }

/** Lines of one calc block, evaluated together. */
function sheet(lines: string[], options: CalcOptions = US): (CalcResult | undefined)[] {
  const inputs: CalcInput[] = lines.map((text, i) => ({ kind: "sheet", id: `l${i}`, block: "b", text }))
  const results = calc.evaluate(inputs, options)
  return lines.map((_, i) => results.get(`l${i}`))
}

/** What the answer column shows for a line: its answer, `✗ message`, or nothing. */
function shown(result: CalcResult | undefined): string {
  if (result?.kind === "value") return result.display
  if (result?.kind === "error") return `✗ ${result.message}`
  return ""
}

const answer = (line: string, options: CalcOptions = US) => shown(sheet([line], options)[0])

describe("arithmetic", () => {
  test.each([
    ["2 + 3 * 4", "14"],
    ["(2 + 3) * 4", "20"],
    ["2 ** 10", "1,024"],
    ["2^10", "1,024"],
    ["7 × 6", "42"],
    ["84 ÷ 2", "42"],
    ["3 x 4", "12"],
    ["5!", "120"],
    ["sqrt(81)", "9"],
    ["0xff", "255"],
    ["0.1 + 0.2", "0.3"],
    ["1/3", "≈ 0.3333333333"],
    ["10000 * 1.05^10", "≈ 16,288.94627"],
    ["100 * 1.25", "125"],
    ["1e100", "1e100"],
    ["0.0000001234", "1.234e-7"],
    ["-5 + 2", "-3"],
    ["3 > 2", "true"],
  ])("%p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("keeps every digit for copying", () => {
    const [result] = sheet(["1/3"])
    expect(result?.kind === "value" && result.full).toMatch(/^0\.3{30,}$/)
    expect(result?.kind === "value" && result.approximate).toBe(true)
  })
})

describe("grouped numbers", () => {
  test.each([
    ["1,234 + 1", "1,235"],
    ["1,234,567.5", "1,234,567.5"],
    ["1,00,000 + 5,00,000", "600,000"],
    ["max(1,2)", "2"],
    ["max(1,200)", "200"],
    ["max(1,000,000, 5)", "1,000,000"],
  ])("%p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("Indian grouping when asked", () => {
    expect(answer("12,34,567 * 2", { ...US, numberFormat: "indian" })).toBe("24,69,134")
    expect(answer("1234567 * 2", { locale: "en-IN", numberFormat: "international" })).toBe("2,469,134")
  })

  test.each([
    ["5k", "5,000"],
    ["2 lakh", "200,000"],
    ["1.5 crore", "15,000,000"],
    ["3 million / 4", "750,000"],
  ])("scale word %p → %p", (line, expected) => expect(answer(line)).toBe(expected))
})

describe("percentages", () => {
  test.each([
    ["20% of 85", "17"],
    ["20% off 85", "68"],
    ["20% on 85", "102"],
    ["85 + 20%", "102"],
    ["85 - 20%", "68"],
    ["15 is what % of 60", "25%"],
    ["17 is 20% of what", "85"],
    ["3 / 4 as %", "75%"],
    ["35000 / 120000 as %", "≈ 29.17%"],
    ["savings = 300", "300"],
    ["18%", "18%"],
    ["100 + 10% of 50", "105"],
  ])("%p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("a percentage name keeps behaving as one", () => {
    expect(sheet(["tax = 18%", "100 + tax", "tax of 200", "tax"]).map(shown)).toEqual(["18%", "118", "36", "18%"])
  })

  test("a ratio of names as a percentage", () => {
    expect(sheet(["saved = 300", "salary = 1,200", "saved / salary in %"]).map(shown)).toEqual(["300", "1,200", "25%"])
  })
})

describe("units", () => {
  test.each([
    ["1.5 l in ml", "1,500 ml"],
    // An unspaced unit/unit after a number is one unit; a spaced / divides.
    ["120 km / 40 km/l", "3 l"],
    ["60 km/h * 2 h", "120 km"],
    ["200 °C in °F", "392 °F"],
    ["12 V * 2 A", "24 W"],
    ["(5 V - 2 V) / 20 mA", "150 Ω"],
    ["2 h + 15 min", "2.25 h"],
    ["2 h 15 min to min", "135 min"],
    ["5 ft 10 in to cm", "177.8 cm"],
    ["10 in to cm", "25.4 cm"],
    ["100 km/h to mph", "≈ 62.13711922 mph"],
    ["1 knot to km/h", "1.852 km/h"],
    ["sin(30°)", "0.5"],
    ["75 MB/s * 2 s", "150 MB"],
    ["10 sq ft to m^2", "0.9290304 m²"],
    ["min(4, 2)", "2"],
  ])("%p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("units that don't go together say so", () => {
    expect(answer("2 kg + 3 m")).toBe("✗ These units don't go together")
  })
})

describe("money", () => {
  test.each([
    ["$5 * 3", "$15"],
    ["₹1,200 + ₹50", "₹1,250"],
    ["€40 / 3", "≈ €13.33"],
    ["20 GBP * 2", "£40"],
    ["$1.5k", "$1,500"],
  ])("without rates %p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("converting needs rates, and says so without them", () => {
    expect(answer("100 USD in INR")).toBe("✗ Exchange rates aren't loaded yet, so USD and INR can't be mixed")
    expect(answer("€40 + $10")).toBe("✗ Exchange rates aren't loaded yet, so EUR and USD can't be mixed")
  })

  test.each([
    ["100 USD in INR", "₹8,000"],
    ["€40 + $10", "€48"],
    ["£8 to EUR", "€10"],
    ["1000 JPY in USD", "≈ $7.81"],
  ])("with rates %p → %p", (line, expected) => expect(answer(line, { ...US, rates: RATES })).toBe(expected))

  test("an exact amount stays exact when rates are loaded", () => {
    // Real rates aren't round, so rupees go through float conversion factors.
    const rates = { base: "EUR", date: "2026-10-22", rates: { USD: 1.0817, INR: 90.3712, GBP: 0.8423 } }
    expect(answer("₹4,500 * 3", { ...US, rates })).toBe("₹13,500")
    expect(answer("₹1,350.50 + ₹0", { ...US, rates })).toBe("₹1,350.50")
  })

  test("lakh grouping for rupees", () => {
    expect(answer("₹1,23,456 * 10", { ...US, numberFormat: "indian" })).toBe("₹12,34,560")
  })
})

describe("dates", () => {
  test.each([
    ["today", "Oct 22, 2026"],
    ["today + 3 days", "Oct 25, 2026"],
    ["tomorrow", "Oct 23, 2026"],
    ["2026-12-25 - today", "64 days"],
    ["2026-12-25 - 2026-12-24", "1 day"],
    ["2026-03-01 + 1 week", "Mar 8, 2026"],
  ])("%p → %p", (line, expected) => expect(answer(line)).toBe(expected))

  test("never guesses what a slashed date means", () => {
    expect(answer("16/09/2026")).toBe("✗ “16/09/2026” looks like a date: write 2026-09-16, or put spaces around “/” to divide")
    expect(answer("16 / 9 / 2")).toBe("≈ 0.8888888889")
  })
})

describe("line grammar", () => {
  test("labels, comments, headings and dividers", () => {
    expect(sheet(["# Trip", "Hotel: 3 * 120 // per night", "// assumptions", "---", "Snacks:"]).map((r) => r?.kind)).toEqual([
      "silent",
      "value",
      "silent",
      "silent",
      "silent",
    ])
  })

  test("a trailing = or => is just the equals key", () => {
    expect(sheet(["2 + 3 =", "2 + 3 =>", "4 == 4"]).map(shown)).toEqual(["5", "5", "true"])
  })

  test("only a name goes before =", () => {
    const [result] = sheet(["2 + 3 = 5"])
    expect(result).toMatchObject({ kind: "error", message: "Only a name can go before “=”", range: [6, 7] })
  })

  test("10:30 is not a label", () => {
    expect(answer("10:30")).toBe("✗ Times like 10:30 aren't supported")
  })
})

describe("names", () => {
  test("multi-word, any case, declared above", () => {
    const results = sheet(["monthly rent = 2,100", "Monthly Rent * 12", "MONTHLY   RENT"])
    expect(results.map(shown)).toEqual(["2,100", "25,200", "2,100"])
    expect(results[0]).toMatchObject({ name: "monthly rent" })
  })

  test("redeclaring reads the old value", () => {
    expect(sheet(["fee = 10", "fee = fee * 2", "fee"]).map(shown)).toEqual(["10", "20", "20"])
  })

  test("words that are units, functions or keywords can be names", () => {
    expect(sheet(["total = 5", "total * 2", "count = 3", "count + 1", "m = 4", "3 m"]).map(shown)).toEqual(["5", "10", "3", "4", "4", "12"])
  })

  test("a divider forgets names above it", () => {
    expect(sheet(["a = 1", "---", "a + 1"]).map(shown)[2]).toBe("✗ Unknown word “a”")
  })

  test("using a name whose line failed points at it", () => {
    expect(sheet(["x = 2 +", "x * 2"]).map(shown)).toEqual(["✗ Unfinished calculation", "✗ “x” has a problem above"])
  })

  test("functions", () => {
    expect(sheet(["area(w, h) = w * h", "area(3 m, 4 m)", "tip(bill) = bill * 15%", "tip(80)", "area(1)"]).map(shown)).toEqual([
      "",
      "12 m²",
      "",
      "12",
      "✗ Wrong number of values for “area”",
    ])
  })

  test("a name being typed is unfinished, not wrong", () => {
    expect(sheet(["rent ="])[0]).toMatchObject({ kind: "error", incomplete: true, message: "“rent” isn't defined yet" })
    expect(sheet(["rent = 5", "rent ="]).map(shown)).toEqual(["5", "5"])
  })
})

describe("aggregates", () => {
  test("sum, subtotal, total over the run", () => {
    expect(sheet(["1", "2", "subtotal", "3", "4", "subtotal", "total", "average", "median", "count", "previous"]).map(shown)).toEqual([
      "1",
      "2",
      "3",
      "3",
      "4",
      "7",
      "10",
      "2.5",
      "2.5",
      "4",
      "4",
    ])
  })

  test("a blank line or heading starts a new run", () => {
    expect(sheet(["5", "", "1", "sum", "# Next", "2", "sum"]).map(shown)).toEqual(["5", "", "1", "1", "", "2", "2"])
  })

  test("an empty run sums to 0 and has no average", () => {
    expect(sheet(["sum", "count", "avg"]).map(shown)).toEqual(["0", "0", "✗ There's nothing above to average"])
  })

  test("a failing line is named instead of skipped", () => {
    expect(sheet(["100", "2 +", "50", "sum"]).map(shown)[3]).toBe("✗ Line 2 has a problem: Unfinished calculation")
  })

  test("units and currencies add up in the first one's unit", () => {
    expect(sheet(["1 km", "500 m", "sum"]).map(shown)[2]).toBe("1.5 km")
    expect(sheet(["€10", "$5", "total"], { ...US, rates: RATES }).map(shown)[2]).toBe("€14")
    expect(sheet(["€10", "$5", "total"]).map(shown)[2]).toBe("✗ Exchange rates aren't loaded yet, so EUR and USD can't be mixed")
  })

  test("mixed kinds don't add up", () => {
    expect(sheet(["5", "20%", "sum"]).map(shown)[2]).toBe("✗ These lines hold different kinds of values")
  })

  test("list forms", () => {
    expect(sheet(["sum(1, 2, 3)", "total(4, 5)", "avg(2, 4)", "count(4, 5, 9)", "median(3, 9, 4)"]).map(shown)).toEqual([
      "6",
      "9",
      "3",
      "3",
      "4",
    ])
  })

  test("each block is its own run", () => {
    const results = calc.evaluate(
      [
        { kind: "sheet", id: "a", block: "one", text: "5" },
        { kind: "sheet", id: "b", block: "two", text: "7" },
        { kind: "sheet", id: "c", block: "two", text: "sum" },
      ],
      US,
    )
    expect(shown(results.get("c"))).toBe("7")
  })
})

describe("line references", () => {
  test("read the line above, wherever it moved", () => {
    const results = calc.evaluate(
      [
        { kind: "sheet", id: "price", block: "b", text: "40" },
        { kind: "sheet", id: "other", block: "b", text: "1000" },
        { kind: "sheet", id: "double", block: "b", text: "@{price} * 2" },
      ],
      US,
    )
    expect(shown(results.get("double"))).toBe("80")
  })

  test("not below, and not removed", () => {
    const results = calc.evaluate(
      [
        { kind: "sheet", id: "a", block: "b", text: "@{b} + 1" },
        { kind: "sheet", id: "b", block: "b", text: "2" },
        { kind: "sheet", id: "c", block: "b", text: "@{gone} + 1" },
      ],
      US,
    )
    expect(shown(results.get("a"))).toBe("✗ A line can only use lines above it")
    expect(shown(results.get("c"))).toBe("✗ The line this pointed to was removed")
  })
})

describe("errors", () => {
  test.each([
    ["foo + 1", "Unknown word “foo”", [0, 3], false],
    ["2 +", "Unfinished calculation", undefined, true],
    ["(3", "Missing “)”", undefined, true],
    ["1/0", "Can't divide by zero", undefined, false],
  ])("%p", (line, message, range, incomplete) => {
    const [result] = sheet([line])
    expect(result).toMatchObject({ kind: "error", message, incomplete })
    if (range) expect(result).toMatchObject({ range })
  })

  test("never shows mathjs internals", () => {
    for (const line of ["2 h * sin", "[1, 2] + 1 kg", "sqrt", "5 USD * 2 kg + 3"]) expect(answer(line)).not.toMatch(/typed|argument|index:/)
  })
})

/** Paragraphs of prose, evaluated together. */
function prose(lines: string[], options: CalcOptions = US) {
  const inputs: CalcInput[] = lines.map((text, i) => ({ kind: "prose", id: `p${i}`, text }))
  const results = calc.evaluate(inputs, options)
  return lines.map((_, i) => results.get(`p${i}`))
}

describe("prose", () => {
  test("answers only lines that end with = or =>", () => {
    expect(prose(["We spent 2 + 3 hours on it.", "Two coffees at 3.50 each come to 2 * 3.50 =", "Flour 500 g * 3 =>"]).map(shown)).toEqual([
      "",
      "7",
      "1,500 g",
    ])
  })

  test("declares names silently and uses them later", () => {
    const results = prose(["rent = 2100", "Over a year that is rent * 12 =", "- Food: 300 + 120 ="])
    expect(results[0]).toEqual({ kind: "silent", name: "rent" })
    expect(results.slice(1).map(shown)).toEqual(["25,200", "420"])
  })

  test("a sentence with = isn't a declaration", () => {
    expect(prose(["The plan = go to the store and buy milk"])[0]).toBeUndefined()
  })

  test("errors only when it asked for an answer", () => {
    expect(prose(["costs 2 kg + 3 m in total"])[0]).toBeUndefined()
    expect(shown(prose(["2 kg + 3 m ="])[0])).toBe("✗ These units don't go together")
  })

  test("answers a paragraph that is wholly a calculation, unprompted, when asked to", () => {
    const auto = { ...US, proseAnswers: "auto" as const }
    const lines = [
      "20% of 85",
      "- Rent: 2100 * 12",
      "1.5 l in ml",
      "We spent 2 + 3 hours on it.",
      "2024",
      "5 km",
      "It takes 2-3 days",
      "2-3",
      "Add 1/2 cup of sugar",
      "Call mom",
      "2 kg + 3 m",
    ]
    expect(prose(lines, auto).map(shown)).toEqual(["17", "25,200", "1,500 ml", "", "", "", "", "", "", "", ""])
    // Off by default: only lines ending in = answer.
    expect(prose(["20% of 85"])[0]).toBeUndefined()
  })

  test("unprompted, a declaration shows what it worked out, but doesn't echo a plain value", () => {
    const results = prose(["rent = 2100", "yearly = rent * 12", "sum"], { ...US, proseAnswers: "auto" })
    expect(results[0]).toEqual({ kind: "silent", name: "rent" })
    // Declarations count towards a total, as in a calc block.
    expect(results.slice(1).map(shown)).toEqual(["25,200", "27,300"])
  })

  test("prose and calc blocks share names", () => {
    const results = calc.evaluate(
      [{ kind: "prose", id: "p", text: "hourly = 90" }, { kind: "heading" }, { kind: "sheet", id: "s", block: "b", text: "hourly * 8" }],
      US,
    )
    expect(shown(results.get("s"))).toBe("720")
  })
})

describe("evaluateOne", () => {
  test.each([
    ["20% of 85", "17"],
    ["2+2", "4"],
    ["5 km in miles", "≈ 3.106855961 miles"],
    ["sqrt(2)", "≈ 1.414213562"],
  ])("%p is a calculation", (text, display) => expect(calc.evaluateOne(text, US)?.display).toBe(display))

  test.each(["42", "hello world", "https://example.com/a", "2024-01-01", "5 km", "$5", "-3", "sum", "meeting at 5", "x = 3"])(
    "%p isn't",
    (text) => expect(calc.evaluateOne(text, US)).toBeNull(),
  )
})

describe("value and summarize", () => {
  test("values on their own", () => {
    expect(calc.value("₹1,200", US)?.display).toBe("₹1,200")
    expect(calc.value("42.5", US)?.display).toBe("42.5")
    expect(calc.value("groceries", US)).toBeNull()
  })

  test("sums and averages compatible values", () => {
    const values = ["100", "250.5", "49.5"].map((t) => calc.value(t, US)!)
    expect(calc.summarize(values, US)).toEqual({ count: 3, sum: "400", average: "≈ 133.3333333" })
  })

  test("no sum across kinds", () => {
    const values = ["5 kg", "$3"].map((t) => calc.value(t, US)!)
    expect(calc.summarize(values, US)).toEqual({ count: 2 })
    expect(calc.summarize([], US)).toEqual({ count: 0 })
  })
})

describe("namesBefore", () => {
  test("names and functions in scope at a line", () => {
    const inputs: CalcInput[] = [
      { kind: "sheet", id: "a", block: "b", text: "rate = 90" },
      { kind: "sheet", id: "b", block: "b", text: "area(w, h) = w * h" },
      { kind: "sheet", id: "c", block: "b", text: "later = 1" },
      { kind: "sheet", id: "d", block: "b", text: "" },
    ]
    calc.evaluate(inputs, US)
    expect(calc.namesBefore(inputs, "c")).toEqual([
      { name: "rate", display: "90" },
      { name: "area", display: "area(w, h)" },
    ])
  })
})

test("a long note evaluates quickly once warm", () => {
  const lines = Array.from({ length: 500 }, (_, i) => (i % 50 === 0 ? `item ${i} = ${i}` : `${i} * 1.5 + 2% // line ${i}`))
  sheet(lines)
  const start = performance.now()
  sheet(lines)
  expect(performance.now() - start).toBeLessThan(100)
})
