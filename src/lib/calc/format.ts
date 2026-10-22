import type { BigNumber, MathJsInstance, Unit } from "mathjs"
import type { NumberFormat } from "./types"

/** What a value means beyond its number, which mathjs doesn't know: it decides how the value is shown. */
export type ValueKind = "plain" | "percent" | "date" | "datetime" | "duration"

export interface Value {
  /** A mathjs value: BigNumber, Unit, boolean, Complex, Matrix… */
  v: unknown
  kind: ValueKind
}

export interface Formatted {
  display: string
  full: string
  approximate: boolean
}

export interface FormatContext {
  math: MathJsInstance
  locale: string
  currencies: ReadonlySet<string>
}

/** Answers show this many significant digits at most; Copy gets them all. */
const SIGNIFICANT = 10
/** Digits kept for `full`: more than anyone reads, fewer than the 64 mathjs carries. */
const FULL_SIGNIFICANT = 34
const SCIENTIFIC_ABOVE = 1e15
const PERCENT_DECIMALS = 2
const SCIENTIFIC_BELOW = 1e-6
export const DAY_MS = 86_400_000

const formatters = new Map<string, Intl.NumberFormat>()
function cached(locale: string, options: Intl.NumberFormatOptions = {}): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(options)}`
  let nf = formatters.get(key)
  if (!nf) formatters.set(key, (nf = new Intl.NumberFormat(locale, options)))
  return nf
}

/** Whether a locale writes 100000 as 1,00,000. */
function groupsIndian(locale: string): boolean {
  return /^1\D00\D000$/.test(cached(locale).format(100_000))
}

/** The locale answers are written in, given the grouping the person asked for. */
export function resolveLocale(locale: string | undefined, numberFormat: NumberFormat = "auto"): string {
  let base = locale ?? globalThis.navigator?.language ?? "en-US"
  try {
    base = Intl.getCanonicalLocales(base)[0] ?? "en-US"
  } catch {
    base = "en-US"
  }
  if (numberFormat === "indian") return groupsIndian(base) ? base : "en-IN"
  if (numberFormat === "international") return groupsIndian(base) ? "en-US" : base
  return base
}

/** Every digit, without exponent where that stays readable. */
function plain(x: BigNumber): string {
  const v = x.toSignificantDigits(FULL_SIGNIFICANT)
  const abs = v.abs()
  return !abs.isZero() && (abs.gte(1e21) || abs.lt(1e-7)) ? v.toExponential().replace("e+", "e") : v.toFixed()
}

export function formatNumber(x: BigNumber, locale: string): Formatted {
  const rounded = x.toSignificantDigits(SIGNIFICANT)
  const approximate = !rounded.eq(x)
  const abs = rounded.abs()
  const display =
    !abs.isZero() && (abs.gte(SCIENTIFIC_ABOVE) || abs.lt(SCIENTIFIC_BELOW))
      ? rounded.toExponential().replace("e+", "e")
      : cached(locale, { maximumFractionDigits: 20 }).format(rounded.toFixed() as `${number}`)
  return { display: approximate ? `≈ ${display}` : display, full: plain(x), approximate }
}

function formatMoney(amount: BigNumber, code: string, locale: string): Formatted {
  let nf: Intl.NumberFormat
  try {
    nf = cached(locale, { style: "currency", currency: code })
  } catch {
    const n = formatNumber(amount, locale)
    return { ...n, display: `${n.display} ${code}`, full: `${n.full} ${code}` }
  }
  const digits = nf.resolvedOptions().maximumFractionDigits ?? 2
  // Conversions through exchange rates leave float noise (13500.0000000001); that isn't a rounded answer.
  const settled = amount.toSignificantDigits(15)
  const rounded = settled.toDecimalPlaces(digits)
  const approximate = !rounded.eq(settled)
  // Whole amounts read better without their cents: ₹13,500, but ₹1,350.50.
  const whole = rounded.isInteger()
    ? cached(locale, { style: "currency", currency: code, minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : nf
  const display = rounded.abs().gte(SCIENTIFIC_ABOVE)
    ? `${rounded.toSignificantDigits(SIGNIFICANT).toExponential().replace("e+", "e")} ${code}`
    : whole.format(rounded.toFixed() as `${number}`)
  return { display: approximate ? `≈ ${display}` : display, full: `${plain(amount)} ${code}`, approximate }
}

const SUPERSCRIPT: Readonly<Record<string, string>> = { "2": "²", "3": "³" }

/** `km / h` → `km/h`, `degC` → `°C`, `m^2` → `m²`. */
function prettyUnit(units: string): string {
  return (
    units
      .replace(/\bdeg([CF])\b/g, "°$1")
      .replace(/\bdeg\b/g, "°")
      .replace(/\bohm\b/g, "Ω")
      // Spelled out by the aliases for `min`, `sec` and `hrs`; shown the short way.
      .replace(/\bminute\b/g, "min")
      .replace(/\bsecond\b/g, "s")
      .replace(/\bhour\b/g, "h")
      .replace(/\^([23])\b/g, (_, p: string) => SUPERSCRIPT[p]!)
      .replaceAll(" / ", "/")
  )
}

/** The unit as shown: derived units simplified the way mathjs's own `format` does (`V A` → `W`). */
function shown(unit: Unit): Unit {
  return (unit as Unit & { skipAutomaticSimplification?: boolean }).skipAutomaticSimplification ? unit : unit.simplify()
}

export function isCurrency(unit: Unit, currencies: ReadonlySet<string>): string | null {
  const parts = unit.units
  const only = parts.length === 1 ? parts[0] : undefined
  return only && only.power === 1 && currencies.has(only.unit.name) ? only.unit.name : null
}

function formatUnit(unit: Unit, ctx: FormatContext): Formatted {
  const u = shown(unit)
  if (u.value === null) return { display: prettyUnit(u.formatUnits()), full: u.formatUnits(), approximate: false }
  const amount = ctx.math.bignumber(u.toNumeric() as BigNumber)
  const code = isCurrency(u, ctx.currencies)
  if (code) return formatMoney(amount, code, ctx.locale)
  const n = formatNumber(amount, ctx.locale)
  return { display: `${n.display} ${prettyUnit(u.formatUnits())}`, full: `${n.full} ${u.formatUnits()}`, approximate: n.approximate }
}

const pad = (n: number) => String(n).padStart(2, "0")

function formatDate(ms: number, withTime: boolean, locale: string): Formatted {
  const date = new Date(ms)
  const display = new Intl.DateTimeFormat(locale, withTime ? { dateStyle: "medium", timeStyle: "short" } : { dateStyle: "medium" }).format(
    date,
  )
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return { display, full: withTime ? `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}` : day, approximate: false }
}

export function format(value: Value, ctx: FormatContext): Formatted {
  const { math } = ctx
  const v = value.v as { isBigNumber?: boolean; isUnit?: boolean }
  if (v?.isUnit) {
    const unit = v as Unit
    if (value.kind === "date" || value.kind === "datetime")
      return formatDate(Number(unit.toNumeric("ms")), value.kind === "datetime", ctx.locale)
    if (value.kind === "duration") {
      const days = math.bignumber(unit.toNumeric("day") as BigNumber)
      const n = formatNumber(days, ctx.locale)
      const label = days.eq(1) ? "day" : "days"
      return { ...n, display: `${n.display} ${label}`, full: `${n.full} ${label}` }
    }
    return formatUnit(unit, ctx)
  }
  if (v?.isBigNumber || typeof v === "number") {
    const x = math.bignumber(v as BigNumber)
    if (value.kind === "percent") {
      // A share reads best to two decimals (29.17%); `full` keeps the rest.
      const pct = x.times(100)
      const n = formatNumber(pct.abs().lt(SCIENTIFIC_ABOVE) ? pct.toDecimalPlaces(PERCENT_DECIMALS) : pct, ctx.locale)
      const approximate = n.approximate || !pct.toDecimalPlaces(PERCENT_DECIMALS).eq(pct)
      const display = `${n.display.replace(/^≈\s*/, "")}%`
      return { display: approximate ? `≈ ${display}` : display, full: `${plain(pct)}%`, approximate }
    }
    return formatNumber(x, ctx.locale)
  }
  if (typeof v === "boolean") return { display: v ? "true" : "false", full: String(v), approximate: false }
  return { display: math.format(v, { precision: SIGNIFICANT }), full: math.format(v, { precision: FULL_SIGNIFICANT }), approximate: false }
}
