import type { BigNumber, MathJsInstance, Unit } from "mathjs"
import { DAY_MS, type FormatContext, format, resolveLocale, type Value } from "./format"
import { type Declaration, type LineShape, proseLine, sheetLine, type Token, wholeCalcLine } from "./grammar"
import { compile, createInstance, type Instance, ratesKey } from "./instance"
import type { Calc, CalcInput, CalcOptions, CalcResult, Summary } from "./types"

type ValueResult = Extract<CalcResult, { kind: "value" }>
/** `whole`: a prose paragraph that is wholly a calculation, so no leading words are skipped. */
type CalcShape = Extract<LineShape, { kind: "calc" }> & { whole?: boolean }

interface Failure {
  message: string
  range?: [number, number]
  incomplete: boolean
}

type Outcome = ({ ok: true; value: Value; interpretation: string } | ({ ok: false } & Failure)) & {
  /** The line reads other lines through `sum`, `previous`…, so sums skip it. */
  aggregate: boolean
  subtotal: boolean
}

interface Name {
  /** The identifier the name has in mathjs's scope, so names can't collide with units or functions. */
  id: string
  /** As first declared. */
  display: string
  value?: Value
  /** Why its declaration failed; lines using it say so rather than calling the name unknown. */
  failure?: string
  params?: string[]
}

interface RunEntry {
  label: string
  value?: Value
  failure?: string
  aggregate: boolean
}

const AGGREGATES = {
  sum: "sum",
  total: "sum",
  subtotal: "subtotal",
  average: "average",
  avg: "average",
  median: "median",
  count: "count",
  previous: "previous",
  prev: "previous",
} as const
type Aggregate = (typeof AGGREGATES)[keyof typeof AGGREGATES]

/** `total(1, 2)`, `avg(…)` and `count(…)` as list functions mathjs knows. */
const LIST_FUNCTIONS: Readonly<Record<string, string>> = { total: "sum", avg: "mean", average: "mean", count: "__count" }
const SCALES: Readonly<Record<string, string>> = {
  thousand: "1e3",
  million: "1e6",
  billion: "1e9",
  trillion: "1e12",
  lakh: "1e5",
  lakhs: "1e5",
  lac: "1e5",
  crore: "1e7",
  crores: "1e7",
}
/** Unit spellings mathjs lacks, or reads as functions (`min`, `sec`). */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  min: "minute",
  mins: "minute",
  sec: "second",
  secs: "second",
  hrs: "hour",
  yr: "year",
  yrs: "year",
  wk: "week",
  wks: "week",
}
const DATE_WORDS = new Set(["today", "now", "tomorrow", "yesterday"])
const CONVERSIONS = new Set(["to", "in", "as"])
/** Words that make a line a calculation rather than a value, for the palette. */
const CALC_WORDS = new Set([...CONVERSIONS, "of", "off", "on", "is", "what"])
/** Punctuation that can come before a calculation in a sentence. */
const PROSE_PUNCTUATION = new Set([":", ".", "!", "?", "-", "—", "'", "’", '"', "“", "”", ";"])
const PERCENT_LITERAL = /^\(?-?[\d.]+\)?%$/

const normalizeName = (name: string) => name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim()
const isWs = (t: Token | undefined) => t?.type === "ws"

class Out {
  source = ""
  spans: { from: number; to: number; range: [number, number] }[] = []
  push(text: string, token?: Token) {
    if (token) this.spans.push({ from: this.source.length, to: this.source.length + text.length, range: [token.start, token.end] })
    this.source += text
  }
  rangeAt(index: number): [number, number] | undefined {
    return (this.spans.find((s) => index >= s.from && index < s.to) ?? this.spans.findLast((s) => s.from <= index))?.range
  }
}

interface Rewritten {
  out: Out
  aggregates: Set<Aggregate>
  dates: number
  datetime: boolean
  /** Dates or durations took part, so a time answer reads in days rather than milliseconds. */
  timeish: boolean
  percent: boolean
  /** The whole expression is one name or line, whose kind the answer keeps. */
  only?: Value["kind"]
  currencies: Set<string>
  failure?: Failure
}

/** One top-to-bottom evaluation of a note. */
class Pass {
  readonly names = new Map<string, Name>()
  readonly scope = new Map<string, unknown>()
  readonly results = new Map<string, CalcResult>()
  readonly lines = new Map<string, { value?: Value; failure?: string }>()
  readonly displays = new Map<string, string>()
  run: RunEntry[] = []
  subtotalFrom = 0
  private nextId = 0
  private nextRef = 0
  readonly fmt: FormatContext
  private readonly math: MathJsInstance
  private readonly today: number
  private readonly now: number

  readonly instance: Instance
  private readonly allIds: ReadonlySet<string>
  /** Answer prose that is wholly a calculation, without its `=`. */
  private readonly autoProse: boolean

  constructor(instance: Instance, options: CalcOptions, allIds: ReadonlySet<string> = new Set()) {
    this.instance = instance
    this.allIds = allIds
    this.autoProse = options.proseAnswers === "auto"
    this.math = instance.math
    this.fmt = { math: this.math, locale: resolveLocale(options.locale, options.numberFormat), currencies: instance.currencies }
    const now = options.now ?? new Date()
    this.now = now.getTime()
    this.today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    this.reset()
  }

  /** A divider: every name above it is forgotten. */
  reset() {
    this.names.clear()
    this.scope.clear()
    this.scope.set("__count", (...values: unknown[]) => this.math.bignumber(values.length))
  }

  breakRun() {
    this.run = []
    this.subtotalFrom = 0
  }

  sheet(id: string, text: string, label: string) {
    const shape = sheetLine(text)
    switch (shape.kind) {
      case "blank":
      case "heading":
        this.breakRun()
        return this.results.set(id, { kind: "silent" })
      case "divider":
        this.breakRun()
        this.reset()
        return this.results.set(id, { kind: "silent" })
      case "comment":
      case "label":
        return this.results.set(id, { kind: "silent" })
      case "invalid":
        return this.record(id, label, {
          ok: false,
          message: shape.message,
          range: shape.range,
          incomplete: false,
          aggregate: false,
          subtotal: false,
        })
      case "calc":
        return this.calc(id, shape, label, false)
    }
  }

  prose(id: string, text: string) {
    const shape = proseLine(text) ?? (this.autoProse ? this.unprompted(text) : null)
    if (!shape) return
    const snippet = text.trim()
    this.calc(id, shape, `“${snippet.length > 24 ? `${snippet.slice(0, 23)}…` : snippet}”`, true)
  }

  /**
   * A paragraph answered without being asked (no `=`): only when the whole of it is a real calculation. A lone
   * value (`2024`, `5 km`) is just text, and `2-3 days` or `1/2 cup` in prose are a range and a fraction.
   */
  private unprompted(text: string): CalcShape | null {
    const shape = wholeCalcLine(text)
    if (!shape || isPlainValue(shape.tokens) || hasBareRange(shape.tokens)) return null
    return { ...shape, whole: true }
  }

  private calc(id: string, shape: CalcShape, label: string, prose: boolean) {
    const { tokens, declaration, equals } = shape
    if (declaration?.params) return this.defineFunction(id, declaration, tokens, prose)
    const empty = !tokens.some((t) => t.type !== "ws")
    if (empty) {
      if (prose) return
      const failure = declaration
        ? { message: "Write a value after “=”", incomplete: true }
        : { message: "Nothing to work out", incomplete: true }
      return this.record(id, label, { ok: false, ...failure, aggregate: false, subtotal: false })
    }

    let outcome = prose && !declaration && !shape.whole ? this.firstThatWorks(tokens) : this.compute(tokens)
    if (!outcome) return
    // `rent =` with no `rent` yet is a declaration being typed, not a mistake.
    const words = tokens.filter((t) => t.type !== "ws")
    if (!outcome.ok && equals && !declaration && words.every((t) => t.type === "word") && outcome.message.startsWith("Unknown word"))
      outcome = { ...outcome, message: `“${words.map((t) => t.text).join(" ")}” isn't defined yet`, incomplete: true }

    if (prose && !outcome.ok && !equals) return
    if (declaration) {
      if (outcome.ok) this.declare(declaration.name, outcome.value)
      else this.declareFailure(declaration.name, outcome.message)
    }
    // `total = rent * 12` shows what it worked out (when answering unprompted); `rent = 2100` needs no echo.
    if (prose && declaration && !equals && outcome.ok && !(this.autoProse && !isPlainValue(tokens))) {
      this.record(id, label, outcome, { kind: "silent", name: declaration.name })
      return
    }
    this.record(id, label, outcome, undefined, declaration?.name)
  }

  private record(id: string, label: string, outcome: Outcome, result?: CalcResult, name?: string) {
    if (outcome.ok) {
      this.results.set(id, result ?? this.valueResult(outcome.value, outcome.interpretation, name))
      this.lines.set(id, { value: outcome.value })
      this.run.push({ label, value: outcome.value, aggregate: outcome.aggregate })
    } else {
      const { message, range, incomplete } = outcome
      this.results.set(id, { kind: "error", message, range, incomplete })
      this.lines.set(id, { failure: message })
      this.run.push({ label, failure: message, aggregate: outcome.aggregate })
    }
    if (outcome.subtotal) this.subtotalFrom = this.run.length
  }

  valueResult(value: Value, interpretation: string, name?: string): ValueResult {
    const { display, full, approximate } = format(value, this.fmt)
    return { kind: "value", display, full, interpretation, approximate, value, ...(name ? { name } : {}) }
  }

  private entry(name: string): Name {
    const key = normalizeName(name)
    let entry = this.names.get(key)
    if (!entry) {
      entry = { id: `__v${this.nextId++}`, display: name.replace(/\s+/g, " ") }
      this.names.set(key, entry)
      this.displays.set(entry.id, entry.display)
    }
    return entry
  }

  private declare(name: string, value: Value) {
    const entry = this.entry(name)
    Object.assign(entry, { value, failure: undefined, params: undefined })
    this.scope.set(entry.id, value.v)
  }

  private declareFailure(name: string, failure: string) {
    const entry = this.entry(name)
    Object.assign(entry, { value: undefined, failure, params: undefined })
    this.scope.delete(entry.id)
  }

  private defineFunction(id: string, declaration: Declaration, tokens: Token[], prose: boolean) {
    const params = declaration.params ?? []
    const entry = this.entry(declaration.name)
    const rw = this.rewrite(tokens, new Set(params))
    const fail = (failure: Failure) => {
      if (prose) return
      this.declareFailure(declaration.name, failure.message)
      this.results.set(id, { kind: "error", ...failure })
    }
    if (rw.failure) return fail(rw.failure)
    if (!rw.out.source.trim()) return fail({ message: "Write the function's formula after “=”", incomplete: true })
    try {
      compile(this.instance, `${entry.id}(${params.join(", ")}) = ${rw.out.source}`).code.evaluate(this.scope)
    } catch (error) {
      return fail(this.explain(error, rw))
    }
    Object.assign(entry, { value: undefined, failure: undefined, params })
    this.results.set(id, { kind: "silent", name: declaration.name })
  }

  /** Prose before the calculation is skipped: tries each place it could start, and keeps the first that works. */
  private firstThatWorks(tokens: Token[]): Outcome | null {
    let first: Outcome | null = null
    let tries = 0
    for (let i = 0; i < tokens.length && tries < 8; i++) {
      if (!this.couldStart(tokens, i)) continue
      // Only after words: starting inside a calculation would answer part of it (`3 m` of `2 kg + 3 m`).
      const before = tokens[this.previousSignificant(tokens, i)]
      if (before && before.type !== "word" && !(before.type === "op" && PROSE_PUNCTUATION.has(before.value))) continue
      tries++
      const outcome = this.compute(tokens.slice(i))
      if (outcome.ok) return outcome
      first ??= outcome
    }
    return first
  }

  private couldStart(tokens: Token[], i: number): boolean {
    const t = tokens[i]!
    switch (t.type) {
      case "num":
      case "date":
      case "cur":
      case "ref":
      case "open":
        return true
      case "op":
        return (t.value === "-" || t.value === "+") && tokens[i + 1]?.type === "num"
      case "word": {
        const word = t.value.toLowerCase()
        if (DATE_WORDS.has(word) || this.nameAt(tokens, i)) return true
        if (tokens[i + 1]?.type === "open") return typeof (this.math as unknown as Record<string, unknown>)[t.value] === "function"
        if (word in AGGREGATES) return !tokens.slice(i + 1).some((n) => n.type === "word" || n.type === "num")
        return false
      }
      default:
        return false
    }
  }

  /** The longest declared name made of the words starting at `i`, and the index after it. */
  private nameAt(tokens: Token[], i: number): { name: Name; next: number } | null {
    const words: string[] = []
    let found: { name: Name; next: number } | null = null
    for (let j = i; j < tokens.length && words.length < 6; j += 2) {
      const t = tokens[j]!
      if (t.type !== "word") break
      words.push(t.value)
      const name = this.names.get(normalizeName(words.join(" ")))
      if (name) found = { name, next: j + 1 }
      if (!isWs(tokens[j + 1])) break
    }
    return found
  }

  private nextSignificant(tokens: Token[], i: number): number {
    let j = i + 1
    while (isWs(tokens[j])) j++
    return j
  }

  private previousSignificant(tokens: Token[], i: number): number {
    let j = i - 1
    while (isWs(tokens[j])) j--
    return j
  }

  private isUnitWord(word: string): boolean {
    try {
      return this.math.Unit.isValuelessUnit(word)
    } catch {
      return false
    }
  }

  private dateMs(token: Token): number {
    if (token.type === "date") {
      const [, y, m, d, h, min] = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(token.value)!
      return new Date(Number(y), Number(m) - 1, Number(d), Number(h ?? 0), Number(min ?? 0)).getTime()
    }
    const word = token.value.toLowerCase()
    if (word === "now") return this.now
    return this.today + (word === "tomorrow" ? DAY_MS : word === "yesterday" ? -DAY_MS : 0)
  }

  /** Turns the line's tokens into mathjs source: names to their scope ids, phrases to arithmetic. */
  rewrite(tokens: Token[], params?: ReadonlySet<string>): Rewritten {
    const rw: Rewritten = {
      out: new Out(),
      aggregates: new Set(),
      dates: 0,
      datetime: false,
      timeish: false,
      percent: false,
      currencies: new Set(),
    }
    const sig = tokens.map((t, i) => [t, i] as const).filter(([t]) => t.type !== "ws")
    if (sig.length === 1) {
      const [only] = sig[0]!
      const name = only.type === "word" ? this.names.get(normalizeName(only.value))?.value : undefined
      const line = only.type === "ref" ? this.lines.get(only.value)?.value : undefined
      rw.only = (name ?? line)?.kind
    }

    // Whole-line phrases, outside any brackets.
    let end = tokens.length
    const last = sig.at(-1)
    const beforeLast = sig.at(-2)
    if (last?.[0].type === "pct" && beforeLast?.[0].type === "word" && CONVERSIONS.has(beforeLast[0].value.toLowerCase())) {
      rw.percent = true
      end = beforeLast[1]
    }
    const top = this.topLevelWords(tokens, end)
    const is = top.find(([w]) => w === "is")
    if (is) {
      const after = sig.filter(([, i]) => i > is[1] && i < end).map(([t]) => t)
      // `A is what % of B`
      if (after[0]?.value.toLowerCase() === "what" && after[1]?.type === "pct" && after[2]?.value.toLowerCase() === "of") {
        const of = sig.find(([t, i]) => i > is[1] && t === after[2])![1]
        rw.percent = true
        rw.out.push("((")
        this.emit(tokens, 0, is[1], rw, params)
        rw.out.push(") / (")
        this.emit(tokens, of + 1, end, rw, params)
        rw.out.push("))")
        return rw
      }
      // `A is X% of what`
      const tail = sig.filter(([, i]) => i < end).slice(-3)
      if (tail[0]?.[0].type === "pct" && tail[1]?.[0].value.toLowerCase() === "of" && tail[2]?.[0].value.toLowerCase() === "what") {
        rw.out.push("((")
        this.emit(tokens, 0, is[1], rw, params)
        rw.out.push(") / ((")
        this.emit(tokens, is[1] + 1, tail[0][1], rw, params)
        rw.out.push(") / 100))")
        return rw
      }
    }
    // `X% off B`, `X% on B`
    const offOn = top.find(([w, i]) => (w === "off" || w === "on") && tokens[this.previousSignificant(tokens, i)]?.type === "pct")
    if (offOn) {
      const pct = this.previousSignificant(tokens, offOn[1])
      const start = this.operandStart(tokens, pct)
      this.emit(tokens, 0, start, rw, params)
      rw.out.push("((")
      this.emit(tokens, offOn[1] + 1, end, rw, params)
      rw.out.push(`) * (1 ${offOn[0] === "off" ? "-" : "+"} (`)
      this.emit(tokens, start, pct, rw, params)
      rw.out.push(") / 100))")
      return rw
    }
    this.emit(tokens, 0, end, rw, params)
    return rw
  }

  /**
   * `45 km/l`, written without spaces around the `/`, is one unit: the end of `km/l` when `i` is the number
   * before such a unit, else -1. A spaced `/` still divides.
   */
  private compoundUnitEnd(tokens: Token[], i: number, to: number): number {
    const u = this.nextSignificant(tokens, i)
    const [first, slash, second] = [tokens[u], tokens[u + 1], tokens[u + 2]]
    if (u + 2 >= to || first?.type !== "word" || slash?.type !== "op" || slash.value !== "/" || second?.type !== "word") return -1
    return this.isUnitWord(first.value) && this.isUnitWord(second.value) ? u + 2 : -1
  }

  /** Lowercased words outside brackets, before `end`. */
  private topLevelWords(tokens: Token[], end: number): [string, number][] {
    const words: [string, number][] = []
    let depth = 0
    for (let i = 0; i < end; i++) {
      const t = tokens[i]!
      if (t.type === "open") depth++
      else if (t.type === "close") depth--
      else if (depth === 0 && t.type === "word") words.push([t.value.toLowerCase(), i])
    }
    return words
  }

  /** Where the operand ending just before `i` starts: one token, a bracketed group, or a currency amount. */
  private operandStart(tokens: Token[], i: number): number {
    let j = this.previousSignificant(tokens, i)
    if (tokens[j]?.type === "close") {
      for (let depth = 0; j >= 0; j--) {
        const t = tokens[j]!
        if (t.type === "close") depth++
        else if (t.type === "open" && --depth === 0) break
      }
      return Math.max(j, 0)
    }
    const before = this.previousSignificant(tokens, j)
    return tokens[before]?.type === "cur" ? before : Math.max(j, 0)
  }

  private emit(tokens: Token[], from: number, to: number, rw: Rewritten, params?: ReadonlySet<string>) {
    const { out } = rw
    /** What the last two significant tokens put out, for `2 h 15 min` → `2 h + 15 min`. */
    const emitted: ("num" | "unit" | "other")[] = []
    const note = (kind: "num" | "unit" | "other") => emitted.push(kind)
    const fail = (message: string, token: Token) => {
      rw.failure ??= { message, range: [token.start, token.end], incomplete: false }
    }

    const emitNumber = (i: number): number => {
      const t = tokens[i]!
      const next = tokens[i + 1]
      if (next?.type === "word" && /^[kK]$/.test(next.value)) {
        out.push(`(${t.value} * 1000)`, t)
        return i + 1
      }
      const n = this.nextSignificant(tokens, i)
      const following = tokens[n]
      const scale = following?.type === "word" ? SCALES[following.value.toLowerCase()] : undefined
      if (scale && n < to) {
        out.push(`(${t.value} * ${scale})`, t)
        return n
      }
      out.push(t.value, t)
      return i
    }

    /** Index of the last token of a compound unit being bracketed (`45 km/l`), whose `)` is still to come. */
    let closeAfter = -1

    for (let i = from; i < to; i++) {
      if (closeAfter >= 0 && i > closeAfter) {
        out.push(")")
        closeAfter = -1
      }
      const t = tokens[i]!
      const next = tokens[this.nextSignificant(tokens, i)]
      const prev = tokens[this.previousSignificant(tokens, i)]
      switch (t.type) {
        case "ws":
          out.push(" ")
          continue
        case "num": {
          const after = tokens[this.nextSignificant(tokens, i)]
          if (emitted.at(-1) === "unit" && emitted.at(-2) === "num" && after?.type === "word" && this.isUnitWord(after.value))
            out.push("+ ")
          const compound = this.compoundUnitEnd(tokens, i, to)
          if (compound >= 0) {
            out.push("(", t)
            closeAfter = compound
          }
          i = emitNumber(i)
          note("num")
          continue
        }
        case "date":
          rw.dates++
          rw.timeish = true
          if (t.value.includes("T")) rw.datetime = true
          out.push(`(${this.dateMs(t)} ms)`, t)
          note("other")
          continue
        case "slashdate": {
          const [a, b, c] = t.value.split("/")
          const iso =
            a!.length === 4 ? `${a}-${b!.padStart(2, "0")}-${c!.padStart(2, "0")}` : `${c}-${b!.padStart(2, "0")}-${a!.padStart(2, "0")}`
          fail(`“${t.text}” looks like a date: write ${iso}, or put spaces around “/” to divide`, t)
          continue
        }
        case "cur": {
          rw.currencies.add(t.value)
          const n = this.nextSignificant(tokens, i)
          if (tokens[n]?.type === "num" && n < to) {
            out.push("(", t)
            i = emitNumber(n)
            out.push(` ${t.value})`)
          } else out.push(t.value, t)
          note("other")
          continue
        }
        case "ref": {
          const line = this.lines.get(t.value)
          if (!line) {
            fail(this.allIds.has(t.value) ? "A line can only use lines above it" : "The line this pointed to was removed", t)
            continue
          }
          if (line.failure !== undefined) fail("The line this uses has a problem", t)
          else if (!line.value) fail("The line this uses has no answer", t)
          else this.emitValue(line.value, `__r${this.nextRef++}`, t, next, rw)
          note("other")
          continue
        }
        case "pct":
          if (next?.type === "word" && next.value.toLowerCase() === "of") {
            out.push(" / 100 *", t)
            i = this.nextSignificant(tokens, i)
          } else out.push("%", t)
          note("other")
          continue
        case "op":
          if (t.value === "=" || t.value === "=>") fail("Only one “=” can go in a line", t)
          // mathjs reads `10:30` as a range of numbers, which nobody writing a note means.
          else if (t.value === ":") fail("Times like 10:30 aren't supported", t)
          else out.push(t.value, t)
          note("other")
          continue
        case "open":
        case "close":
        case "comma":
          out.push(t.value, t)
          note("other")
          continue
        case "word":
          break
      }

      const word = t.value
      const lower = word.toLowerCase()
      if (params?.has(word)) {
        out.push(word, t)
        note("other")
        continue
      }
      const named = this.nameAt(tokens, i)
      if (named && named.next <= to) {
        const { name } = named
        const span = { ...t, end: tokens[named.next - 1]!.end }
        i = named.next - 1
        if (name.failure !== undefined) fail(`“${name.display}” has a problem above`, span)
        else if (name.params || !name.value) out.push(name.id, span)
        else this.emitValue(name.value, name.id, span, tokens[this.nextSignificant(tokens, i)], rw)
        if (rw.out.source.endsWith(" / 100 *")) i = this.nextSignificant(tokens, i)
        note("other")
        continue
      }
      if (lower in AGGREGATES && !params) {
        if (next?.type === "open") out.push(LIST_FUNCTIONS[lower] ?? lower, t)
        else {
          const aggregate = AGGREGATES[lower as keyof typeof AGGREGATES]
          rw.aggregates.add(aggregate)
          out.push(`__agg_${aggregate}`, t)
        }
        note("other")
        continue
      }
      if (DATE_WORDS.has(lower)) {
        rw.dates++
        rw.timeish = true
        if (lower === "now") rw.datetime = true
        out.push(`(${this.dateMs(t)} ms)`, t)
        note("other")
        continue
      }
      if (lower === "x" && (prev?.type === "num" || prev?.type === "close") && (next?.type === "num" || next?.type === "open")) {
        out.push("*", t)
        note("other")
        continue
      }
      // `10 in`, `5 ft 10 in`, `10 in to cm`: inches, not a conversion.
      if (word === "in" && prev?.type === "num" && (!next || next.type !== "word" || CONVERSIONS.has(next.value.toLowerCase()))) {
        out.push("inch", t)
        note("unit")
        continue
      }
      if (lower === "as") {
        out.push("to", t)
        note("other")
        continue
      }
      if (lower === "sq" && next?.type === "word" && this.isUnitWord(next.value)) {
        i = this.nextSignificant(tokens, i)
        out.push(`${next.value}^2`, { ...t, end: next.end })
        note("unit")
        continue
      }
      const alias = UNIT_ALIASES[word]
      if (alias && next?.type !== "open") {
        out.push(alias, t)
        note("unit")
        continue
      }
      if (this.instance.currencies.has(word)) rw.currencies.add(word)
      out.push(word, t)
      note(this.isUnitWord(word) ? "unit" : "other")
    }
    if (closeAfter >= 0) out.push(")")
  }

  /** A name's or line's value: percentages stay percentages (`85 + tax` adds 18%), dates count as dates. */
  private emitValue(value: Value, id: string, token: Token, next: Token | undefined, rw: Rewritten) {
    if (value.kind === "percent") {
      const percent = this.math.multiply(value.v as BigNumber, 100).toString()
      if (next?.type === "word" && next.value.toLowerCase() === "of") rw.out.push(`(${percent}) / 100 *`, token)
      else rw.out.push(`(${percent})%`, token)
      return
    }
    if (value.kind === "date" || value.kind === "datetime") {
      rw.dates++
      if (value.kind === "datetime") rw.datetime = true
    }
    if (value.kind !== "plain") rw.timeish = true
    this.scope.set(id, value.v)
    rw.out.push(id, token)
  }

  compute(tokens: Token[]): Outcome {
    const rw = this.rewrite(tokens)
    const flags = { aggregate: rw.aggregates.size > 0, subtotal: rw.aggregates.has("subtotal") }
    const failed = (failure: Failure): Outcome => ({ ok: false, ...failure, ...flags })
    if (rw.failure) return failed(rw.failure)

    let compiled
    try {
      compiled = compile(this.instance, rw.out.source)
    } catch (error) {
      return failed(this.explain(error, rw))
    }
    for (const aggregate of rw.aggregates) {
      const result = this.aggregate(aggregate)
      if ("failure" in result) {
        const token = tokens.find((t) => t.type === "word" && AGGREGATES[t.value.toLowerCase() as keyof typeof AGGREGATES] === aggregate)
        return failed({ message: result.failure, range: token && [token.start, token.end], incomplete: false })
      }
      if (rw.out.source.trim() === `__agg_${aggregate}`) rw.only = result.value.kind
      this.scope.set(`__agg_${aggregate}`, result.value.v)
    }

    let result: unknown
    try {
      result = compiled.code.evaluate(this.scope)
    } catch (error) {
      return failed(this.explain(error, rw))
    }
    const value = this.classify(result, rw)
    if ("message" in value) return failed(value)
    return { ok: true, value, interpretation: this.interpret(rw.out.source), ...flags }
  }

  private classify(result: unknown, rw: Rewritten): Value | Failure {
    const { math } = this
    if (typeof result === "function") return { message: "Put the values in brackets after the function's name", incomplete: true }
    if (result === undefined || result === null) return { message: "This has no answer", incomplete: false }
    const r = result as { isBigNumber?: boolean; isUnit?: boolean; isFinite?: () => boolean }
    if (r.isBigNumber && !(result as BigNumber).isFinite())
      return { message: (result as BigNumber).isNaN() ? "This isn't a number" : "Can't divide by zero", incomplete: false }
    if (rw.percent) {
      if (!r.isBigNumber) return { message: "Only a plain number can be shown as a percentage", incomplete: false }
      return { v: result, kind: "percent" }
    }
    if (rw.only) return { v: result, kind: rw.only }
    if (PERCENT_LITERAL.test(rw.out.source.replace(/\s+/g, ""))) return { v: result, kind: "percent" }
    if (r.isUnit) {
      const unit = result as Unit
      const value = unit.value as unknown as BigNumber | null
      if (value && typeof value === "object" && !value.isFinite()) return { message: "Can't divide by zero", incomplete: false }
      const time = unit.equalBase(math.unit("1 s"))
      if (time && rw.dates === 1) return { v: result, kind: rw.datetime ? "datetime" : "date" }
      if (time && rw.dates >= 2) return { v: result, kind: "duration" }
      if (time && rw.timeish) return { v: unit.to("day"), kind: "plain" }
    }
    return { v: result, kind: "plain" }
  }

  /** How the line was read, with names back in place of scope ids. */
  private interpret(source: string): string {
    return source
      .replace(/__v\d+/g, (id) => this.displays.get(id) ?? id)
      .replace(/__agg_(\w+)/g, "$1")
      .replace(/__r\d+/g, "line")
      .replace(/__count/g, "count")
      .replace(/\((\d{11,}) ms\)/g, (_, ms: string) => format({ v: this.math.unit(`${ms} ms`), kind: "date" }, this.fmt).display)
      .replace(/\s+/g, " ")
      .trim()
  }

  /** A mathjs error, in words a person can act on. */
  explain(error: unknown, rw: Rewritten): Failure {
    const raw = error instanceof Error ? error.message : String(error)
    const char = /\(char (\d+)\)/.exec(raw)
    const at = char ? rw.out.rangeAt(Number(char[1]) - 1) : undefined
    const end = rw.out.source.trimEnd().length
    if (
      /Unexpected end of expression|Parenthesis \) expected/.test(raw) ||
      (/Value expected/.test(raw) && (!char || Number(char[1]) > end))
    )
      return { message: /Parenthesis/.test(raw) ? "Missing “)”" : "Unfinished calculation", incomplete: true }

    let m: RegExpExecArray | null
    if ((m = /Undefined (symbol|function) (\S+)/.exec(raw))) {
      const word = m[2]!
      const token = rw.out.spans.find((s) => rw.out.source.slice(s.from, s.to) === word)?.range
      if (/^[A-Z]{3}$/.test(word)) return { message: `Unknown currency or word “${word}”`, range: token, incomplete: false }
      return { message: m[1] === "function" ? `Unknown function “${word}”` : `Unknown word “${word}”`, range: token, incomplete: false }
    }
    if (/Units do not match|Cannot convert|do not match/.test(raw))
      return { message: this.mismatch(rw.currencies), range: at, incomplete: false }
    if ((m = /Too (few|many) arguments in function (\S+)/.exec(raw)))
      return { message: `Wrong number of values for “${this.displays.get(m[2]!) ?? m[2]}”`, incomplete: false }
    if (/Division by zero/i.test(raw)) return { message: "Can't divide by zero", incomplete: false }
    if (/Unexpected type of argument|Cannot implicitly convert/.test(raw))
      return { message: rw.currencies.size > 1 ? this.mismatch(rw.currencies) : "These values can't be combined", incomplete: false }
    if ((m = /Unexpected operator (\S+)/.exec(raw))) return { message: `Unexpected “${m[1]}”`, range: at, incomplete: false }
    if ((m = /Syntax error in part "(.+)"/.exec(raw))) return { message: `Can't read “${m[1]}”`, range: at, incomplete: false }
    if (/Value expected/.test(raw)) return { message: "A value is missing here", range: at, incomplete: false }
    return { message: "Couldn't work this out", range: at, incomplete: false }
  }

  mismatch(currencies: ReadonlySet<string>): string {
    const codes = [...currencies]
    if (codes.length > 1) {
      if (!this.instance.hasRates) return `Exchange rates aren't loaded yet, so ${codes.join(" and ")} can't be mixed`
      return `There's no exchange rate between ${codes.join(" and ")}`
    }
    return "These units don't go together"
  }

  private aggregate(kind: Aggregate): { value: Value } | { failure: string } {
    if (kind === "previous") {
      const last = this.run.at(-1)
      if (!last) return { failure: "There's no line above to use" }
      if (last.failure !== undefined) return { failure: `${last.label} has a problem: ${last.failure}` }
      return { value: last.value! }
    }
    const entries = this.run.slice(kind === "subtotal" ? this.subtotalFrom : 0).filter((e) => !e.aggregate)
    const bad = entries.find((e) => e.failure !== undefined)
    if (bad) return { failure: `${bad.label} has a problem: ${bad.failure}` }
    const values = entries.map((e) => e.value!)
    if (kind === "count") return { value: { v: this.math.bignumber(values.length), kind: "plain" } }
    if (!values.length) {
      if (kind === "average" || kind === "median")
        return { failure: `There's nothing above to ${kind === "median" ? "take the median of" : "average"}` }
      return { value: { v: this.math.bignumber(0), kind: "plain" } }
    }
    return combine(this, kind === "subtotal" ? "sum" : kind, values)
  }
}

/** Adds, averages or takes the median of answers, or says why they can't be. */
function combine(pass: Pass, how: "sum" | "average" | "median", values: Value[]): { value: Value } | { failure: string } {
  const { math } = pass.instance
  const kinds = new Set(values.map((v) => v.kind))
  if (kinds.has("date") || kinds.has("datetime")) return { failure: "Dates can't be added up" }
  if (kinds.size > 1) return { failure: "These lines hold different kinds of values" }
  const xs = values.map((v) => v.v)
  try {
    let v: unknown = how === "median" ? math.median(xs as BigNumber[]) : xs.reduce((a, b) => math.add(a as BigNumber, b as BigNumber))
    if (how === "average") v = math.divide(v as BigNumber, math.bignumber(xs.length))
    return { value: { v, kind: values[0]!.kind } }
  } catch {
    const currencies = new Set<string>()
    for (const x of xs) {
      const unit = x as Unit & { isUnit?: boolean }
      if (unit?.isUnit) for (const part of unit.units) if (pass.instance.currencies.has(part.unit.name)) currencies.add(part.unit.name)
    }
    return { failure: currencies.size > 1 ? pass.mismatch(currencies) : "These lines have values that can't be added together" }
  }
}

/** A value on its own (`42`, `5 km`, `$5`, `20%`), as opposed to a calculation, for the palette. */
/** `2-3` or `1/2` written without spaces: in prose that's a range or a fraction, not arithmetic to answer. */
function hasBareRange(tokens: Token[]): boolean {
  return tokens.some(
    (t, i) => t.type === "num" && tokens[i + 1]?.type === "op" && "-/".includes(tokens[i + 1]!.value) && tokens[i + 2]?.type === "num",
  )
}

function isPlainValue(tokens: Token[]): boolean {
  const sig = tokens.filter((t) => t.type !== "ws")
  let numbers = 0
  for (const [i, t] of sig.entries()) {
    if (t.type === "num" || t.type === "date") numbers++
    else if (t.type === "op") {
      if (i > 0 || (t.value !== "-" && t.value !== "+")) return false
    } else if (t.type === "open" || t.type === "comma" || t.type === "ref") return false
    else if (t.type === "word" && (CALC_WORDS.has(t.value.toLowerCase()) || t.value.toLowerCase() in AGGREGATES)) return false
  }
  return numbers <= 1
}

const MAX_INSTANCES = 2

class Engine implements Calc {
  private instances: Instance[] = []
  private lastOptions: CalcOptions = {}

  private instance(options: CalcOptions): Instance {
    const key = ratesKey(options.rates)
    let instance = this.instances.find((i) => i.key === key)
    if (!instance) {
      instance = createInstance(options.rates)
      this.instances = [instance, ...this.instances].slice(0, MAX_INSTANCES)
    }
    return instance
  }

  private pass(inputs: readonly CalcInput[], options: CalcOptions, stopAt?: string): Pass {
    const ids = new Set(inputs.flatMap((input) => ("id" in input ? [input.id] : [])))
    const pass = new Pass(this.instance(options), options, ids)
    let block: string | null = null
    let previous: "sheet" | "prose" | null = null
    let line = 0
    for (const input of inputs) {
      if ("id" in input && input.id === stopAt) break
      switch (input.kind) {
        case "heading":
          pass.breakRun()
          previous = null
          break
        case "divider":
          pass.breakRun()
          pass.reset()
          previous = null
          break
        case "sheet":
          if (previous !== "sheet" || block !== input.block) {
            pass.breakRun()
            line = 0
          }
          previous = "sheet"
          block = input.block
          pass.sheet(input.id, input.text, `Line ${++line}`)
          break
        case "prose":
          if (previous === "sheet") pass.breakRun()
          previous = "prose"
          pass.prose(input.id, input.text)
          break
      }
    }
    return pass
  }

  evaluate(inputs: readonly CalcInput[], options: CalcOptions = {}): Map<string, CalcResult> {
    this.lastOptions = options
    return this.pass(inputs, options).results
  }

  private single(text: string, options: CalcOptions, calculationOnly: boolean): ValueResult | null {
    const shape = sheetLine(text)
    if (shape.kind !== "calc" || shape.declaration) return null
    if (calculationOnly && isPlainValue(shape.tokens)) return null
    const pass = new Pass(this.instance(options), options)
    const outcome = pass.compute(shape.tokens)
    if (!outcome.ok || outcome.aggregate) return null
    return pass.valueResult(outcome.value, outcome.interpretation)
  }

  evaluateOne(text: string, options: CalcOptions = {}): ValueResult | null {
    return this.single(text, options, true)
  }

  value(text: string, options: CalcOptions = {}): ValueResult | null {
    return this.single(text, options, false)
  }

  summarize(results: readonly CalcResult[], options: CalcOptions = {}): Summary {
    const values = results.flatMap((r) => (r.kind === "value" ? [r.value as Value] : []))
    if (!values.length) return { count: 0 }
    const pass = new Pass(this.instance(options), options)
    const sum = combine(pass, "sum", values)
    const average = combine(pass, "average", values)
    return {
      count: values.length,
      ...("value" in sum ? { sum: format(sum.value, pass.fmt).display } : {}),
      ...("value" in average ? { average: format(average.value, pass.fmt).display } : {}),
    }
  }

  namesBefore(inputs: readonly CalcInput[], id: string): { name: string; display: string }[] {
    const pass = this.pass(inputs, this.lastOptions, id)
    return [...pass.names.values()].flatMap((name) => {
      if (name.params) return [{ name: name.display, display: `${name.display}(${name.params.join(", ")})` }]
      if (!name.value) return []
      return [{ name: name.display, display: format(name.value, pass.fmt).display }]
    })
  }
}

export function createCalc(): Calc {
  return new Engine()
}
