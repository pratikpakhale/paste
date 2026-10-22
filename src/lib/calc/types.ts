/**
 * The calculator's contract with the rest of the app. The engine (mathjs underneath) loads on demand through
 * `loadCalc()` in ./index; everything here is types, so importing it costs nothing.
 */

/** One line of a note, in document order, as the calculator sees it. */
export type CalcInput =
  /** A line in a calc block: every line is a calculation. `block` is the block's id; a new block starts a new run. */
  | { kind: "sheet"; id: string; block: string; text: string }
  /**
   * A paragraph of prose. It only answers when it ends its calculation with `=` or `=>`, and declares a name
   * when it is wholly `name = expression`. Anything else is prose and is skipped without an error.
   */
  | { kind: "prose"; id: string; text: string }
  /** A heading ends the current run of lines (for `sum`, `previous`…); names stay visible. */
  | { kind: "heading" }
  /** A horizontal rule ends the run and clears every name declared above it. */
  | { kind: "divider" }

// A reference chip to another line's answer is written into a line's text as `@{<line id>}`. It can only read
// lines above it.

export type CalcResult =
  | {
      kind: "value"
      /** What the answer column shows: rounded to fit, `≈` when that dropped digits. */
      display: string
      /** Every digit, for Copy and the tooltip. */
      full: string
      /** How the line was read, e.g. `1.5 l to ml`, for the tooltip. */
      interpretation: string
      /** Set when the line declared or redeclared a name. */
      name?: string
      /** Whether `display` is rounded from `full`. */
      approximate: boolean
      /** Opaque value for `summarize`; don't inspect it. */
      value: unknown
    }
  | {
      kind: "error"
      /** Short and specific: says what is wrong and, where it can, how to fix it. */
      message: string
      /** Where in the line's text the problem is, when known (UTF-16 offsets into `text`). */
      range?: [number, number]
      /** True for input that is merely unfinished (`2 +`); the editor hides these while the caret is on the line. */
      incomplete: boolean
    }
  /** A declaration with nothing to show (prose `rent = 2100`), a function definition, a comment or a label. */
  | { kind: "silent"; name?: string }

export type NumberFormat = "auto" | "indian" | "international"

export interface ExchangeRates {
  /** ISO 4217 code every rate is quoted against. */
  base: string
  /** Units of each currency per one `base`. */
  rates: Record<string, number>
  /** The day the rates are for, `YYYY-MM-DD`. */
  date: string
}

export interface CalcOptions {
  /** BCP 47 locale for digits and grouping; defaults to the browser's. */
  locale?: string
  /** `indian` groups as 1,00,000; `international` as 100,000; `auto` follows the locale. */
  numberFormat?: NumberFormat
  /** Without rates, amounts in one currency still work; converting between currencies is an error that says why. */
  rates?: ExchangeRates
  /** The clock, for `today` and `now`. */
  now?: Date
  /**
   * Which prose lines answer: `auto` also answers a paragraph that is wholly a calculation (`20% of 85`,
   * `Rent: 2100 * 12`); `explicit` (the default) only lines ending in `=` or `=>`.
   */
  proseAnswers?: "auto" | "explicit"
}

export interface Summary {
  count: number
  /** Formatted like answers; absent when the values can't be added (mixed kinds). */
  sum?: string
  average?: string
}

export interface Calc {
  /**
   * Evaluates a note top to bottom. Returns a result for each sheet line, and for each prose line that answers
   * or declares. Repeated calls reuse parsed lines, so calling it on every edit is cheap.
   */
  evaluate(inputs: readonly CalcInput[], options?: CalcOptions): Map<string, CalcResult>
  /** One expression on its own, for the command palette and clip sums. `null` when it isn't a calculation. */
  evaluateOne(text: string, options?: CalcOptions): Extract<CalcResult, { kind: "value" }> | null
  /**
   * Any single expression, values on their own included (`42.5`, `₹1,200`, `5 km`), e.g. a clip's text to add
   * up with others through `summarize`. `null` when the text isn't a value or doesn't work out.
   */
  value(text: string, options?: CalcOptions): Extract<CalcResult, { kind: "value" }> | null
  /** Count, sum and average of answers, e.g. selected lines. */
  summarize(results: readonly CalcResult[], options?: CalcOptions): Summary
  /** Names and functions in scope at a line (for the `@` picker): declared above it and not cleared since. */
  namesBefore(inputs: readonly CalcInput[], id: string): { name: string; display: string }[]
}
