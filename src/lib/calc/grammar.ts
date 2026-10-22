/**
 * The line grammar on top of mathjs: splits a line into its parts (label, name, expression, trailing `=`)
 * and tokenizes the expression, keeping each token's place in the line so errors can point at it.
 */

export type TokenType = "num" | "date" | "slashdate" | "word" | "cur" | "ref" | "ws" | "op" | "pct" | "open" | "close" | "comma"

export interface Token {
  type: TokenType
  /** As written. */
  text: string
  /** Offsets into the whole line. */
  start: number
  end: number
  /** Normalized: digits without grouping, `degC` for `°C`, the currency code for `$`, the ref's line id… */
  value: string
}

export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = { $: "USD", "€": "EUR", "£": "GBP", "₹": "INR", "¥": "JPY" }

const WS = /\s+/y
const REF = /@\{([^}]+)\}/y
/** `16/09/2026` or `2026/09/16`: dividing those is never what was meant. */
const SLASH_DATE = /(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}\/\d{1,2}\/\d{1,2})(?![\d/.])/y
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?(?![\d:])/y
const RADIX = /0(?:[xX][\da-fA-F]+|[bB][01]+|[oO][0-7]+)/y
/** 1,00,000 and 12,34,56,789. */
const INDIAN = /\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?(?!\d|,\d)/y
/** 100,000 and 1,234,567.89. */
const INTERNATIONAL = /\d{1,3}(?:,\d{3})+(?:\.\d+)?(?!\d|,\d)/y
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y
const DEGREE = /°\s?([CF])(?![\p{L}\p{N}])/uy
const WORD = /[\p{L}_][\p{L}\p{N}_]*/uy
const LONG_OP = /\*\*|<=|>=|==|!=|=>|<<|>>/y

const OP_ALIASES: Readonly<Record<string, string>> = { "**": "^", "×": "*", "÷": "/", "−": "-", "–": "-", "·": "*" }

function match(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at
  return re.exec(text)
}

function validDate(m: RegExpExecArray): boolean {
  const month = Number(m[2])
  const day = Number(m[3])
  return month >= 1 && month <= 12 && day >= 1 && day <= 31
}

/** Splits an expression into tokens. `offset` is where `text` starts in its line. */
export function tokenize(text: string, offset = 0): Token[] {
  const tokens: Token[] = []
  /** Open parentheses, innermost last: whether each belongs to a function call, where commas separate values. */
  const calls: boolean[] = []
  let i = 0
  const push = (type: TokenType, length: number, value: string) => {
    tokens.push({ type, text: text.slice(i, i + length), start: offset + i, end: offset + i + length, value })
    i += length
  }

  while (i < text.length) {
    const ch = text[i]!
    let m: RegExpExecArray | null
    if ((m = match(WS, text, i))) push("ws", m[0].length, " ")
    else if ((m = match(REF, text, i))) push("ref", m[0].length, m[1]!)
    else if ((m = match(SLASH_DATE, text, i))) push("slashdate", m[0].length, m[0])
    else if ((m = match(ISO_DATE, text, i)) && validDate(m)) push("date", m[0].length, m[0])
    else if ((m = match(RADIX, text, i))) push("num", m[0].length, m[0])
    else if ((m = groupedNumber(text, i, calls.at(-1) === true))) push("num", m[0].length, m[0].replaceAll(",", ""))
    else if ((m = match(NUMBER, text, i))) push("num", m[0].length, m[0])
    else if (ch in CURRENCY_SYMBOLS) push("cur", 1, CURRENCY_SYMBOLS[ch]!)
    else if ((m = match(DEGREE, text, i))) push("word", m[0].length, `deg${m[1]}`)
    else if (ch === "°") push("word", 1, "deg")
    else if ((m = match(WORD, text, i))) push("word", m[0].length, m[0] === "π" ? "pi" : m[0])
    else if (ch === "%") push("pct", 1, "%")
    else if (ch === "(") {
      calls.push(tokens.at(-1)?.type === "word")
      push("open", 1, "(")
    } else if (ch === ")") {
      calls.pop()
      push("close", 1, ")")
    } else if (ch === ",") push("comma", 1, ",")
    else if ((m = match(LONG_OP, text, i))) push("op", m[0].length, OP_ALIASES[m[0]] ?? m[0])
    else {
      // One code point, so an emoji stays whole.
      const char = String.fromCodePoint(text.codePointAt(i)!)
      push("op", char.length, OP_ALIASES[char] ?? char)
    }
  }
  return tokens
}

/**
 * A number with grouping commas. Inside a function call's brackets a comma usually separates values, so there
 * it takes at least two groups (`pmt(50,00,000, …)`), and `max(1,200)` stays two values.
 */
function groupedNumber(text: string, at: number, inCall: boolean): RegExpExecArray | null {
  for (const re of [INDIAN, INTERNATIONAL]) {
    const m = match(re, text, at)
    if (m && (!inCall || m[0].split(",").length > 2)) return m
  }
  return null
}

export interface Declaration {
  /** As written, spaces collapsed. */
  name: string
  /** Set for a function definition, `area(w, h) = …`. */
  params?: string[]
}

export type LineShape =
  | { kind: "blank" | "heading" | "divider" | "comment" | "label" }
  | {
      kind: "calc"
      /** The expression (right of `=` for a declaration). */
      tokens: Token[]
      declaration?: Declaration
      /** Ended with `=` or `=>`. */
      equals: boolean
    }
  | { kind: "invalid"; message: string; range: [number, number] }

/** The first `//` that isn't part of a URL's `://`. */
function commentStart(text: string): number {
  for (let i = text.indexOf("//"); i !== -1; i = text.indexOf("//", i + 2)) if (text[i - 1] !== ":") return i
  return text.length
}

/** `Rent: …`: a colon followed by a space or the end. `10:30` stays in the expression. */
const LABEL = /^\s*[^:=@\s][^:=@]*:(?=\s|$)/
/** A trailing `=` or `=>`, but not the end of `==`, `<=`, `>=` or `!=`. */
const TRAILING_EQUALS = /(?:=>|(?<![=<>!])=)\s*$/
const LIST_MARKER = /^\s*(?:[-*+>]|\d+[.)])\s+/

const significant = (tokens: Token[]) => tokens.filter((t) => t.type !== "ws")

/** Index of the first `=` outside brackets, or -1. */
function topLevelEquals(tokens: Token[], from = 0): number {
  let depth = 0
  for (let i = from; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.type === "open") depth++
    else if (t.type === "close") depth--
    else if (depth === 0 && t.type === "op" && t.value === "=") return i
  }
  return -1
}

/** The left of `=` as a name (words) or a function head (`area(w, h)`), or null when it is neither. */
function declarationOf(lhs: Token[], maxWords: number): Declaration | null {
  const sig = significant(lhs)
  if (sig.length >= 3 && sig[0]!.type === "word" && sig[1]!.type === "open" && sig.at(-1)!.type === "close") {
    if (lhs[1]?.type !== "open") return null
    const inner = sig.slice(2, -1)
    const params: string[] = []
    for (let i = 0; i < inner.length; i++) {
      const t = inner[i]!
      if (i % 2 === 0 ? t.type !== "word" : t.type !== "comma") return null
      if (t.type === "word") params.push(t.value)
    }
    if (inner.length && inner.length % 2 === 0) return null
    return { name: sig[0]!.value, params }
  }
  if (!sig.length || sig.length > maxWords || sig.some((t) => t.type !== "word")) return null
  return { name: sig.map((t) => t.value).join(" ") }
}

/** A calc block line. */
export function sheetLine(text: string): LineShape {
  if (!text.trim()) return { kind: "blank" }
  if (/^\s*#/.test(text)) return { kind: "heading" }
  if (/^\s*-{3,}\s*$/.test(text)) return { kind: "divider" }
  if (/^\s*\/\//.test(text)) return { kind: "comment" }

  let end = commentStart(text)
  const start = LABEL.exec(text.slice(0, end))?.[0].length ?? 0
  const trailing = TRAILING_EQUALS.exec(text.slice(start, end))
  if (trailing) end = start + trailing.index
  const tokens = tokenize(text.slice(start, end), start)
  if (!significant(tokens).length) return trailing ? { kind: "label" } : { kind: start ? "label" : "blank" }

  const eq = topLevelEquals(tokens)
  if (eq === -1) return { kind: "calc", tokens, equals: !!trailing }
  const declaration = declarationOf(tokens.slice(0, eq), Infinity)
  const sign = tokens[eq]!
  if (!declaration) return { kind: "invalid", message: "Only a name can go before “=”", range: [sign.start, sign.end] }
  return { kind: "calc", tokens: tokens.slice(eq + 1), declaration, equals: !!trailing }
}

/**
 * A paragraph of prose: only a line ending in `=`/`=>`, or one that is wholly `name = expression`, is a
 * calculation. Null for anything else.
 */
export function proseLine(text: string): Extract<LineShape, { kind: "calc" }> | null {
  const start = LIST_MARKER.exec(text)?.[0].length ?? 0
  let end = text.length
  const trailing = TRAILING_EQUALS.exec(text.slice(start))
  if (trailing) end = start + trailing.index
  const tokens = tokenize(text.slice(start, end), start)
  const eq = topLevelEquals(tokens)
  if (eq !== -1) {
    // A sentence isn't a name: four words at most.
    const declaration = declarationOf(tokens.slice(0, eq), 4)
    if (declaration && topLevelEquals(tokens, eq + 1) === -1)
      return { kind: "calc", tokens: tokens.slice(eq + 1), declaration, equals: !!trailing }
  }
  if (!trailing) return null
  // `If rent = 2100, rent * 12 =`: the calculation is what comes after the last `=`.
  let last = -1
  for (let i = topLevelEquals(tokens); i !== -1; i = topLevelEquals(tokens, i + 1)) last = i
  return { kind: "calc", tokens: tokens.slice(last + 1), equals: true }
}

/**
 * A paragraph that is a calculation and nothing else, after any list marker or label: `20% of 85`,
 * `- Rent: 2100 * 12`. Null for declarations, lines ending in `=` (see `proseLine`) and anything else.
 */
export function wholeCalcLine(text: string): Extract<LineShape, { kind: "calc" }> | null {
  const start = LIST_MARKER.exec(text)?.[0].length ?? 0
  const shape = sheetLine(text.slice(start))
  return shape.kind === "calc" && !shape.declaration && !shape.equals ? shape : null
}
