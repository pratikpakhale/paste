import { all, create, type FactoryFunctionMap, type EvalFunction, type MathJsInstance, type MathNode } from "mathjs"
import type { ExchangeRates } from "./types"

/** Codes known even without rates, so `5 USD * 3` works offline; converting between them needs rates. */
const COMMON_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "INR",
  "JPY",
  "CNY",
  "AUD",
  "CAD",
  "CHF",
  "SGD",
  "AED",
  "HKD",
  "NZD",
  "SEK",
  "NOK",
  "DKK",
  "KRW",
  "BRL",
  "MXN",
  "ZAR",
  "THB",
  "IDR",
  "MYR",
  "PHP",
  "PLN",
  "TRY",
  "SAR",
  "ILS",
  "CZK",
  "HUF",
  "RON",
  "ISK",
]

/** Units people write that mathjs doesn't have, or has under a name that clashes with a function. */
const EXTRA_UNITS: Readonly<Record<string, string>> = {
  mph: "1 mile/hour",
  kph: "1 km/hour",
  kmh: "1 km/hour",
  knot: "1852 m/hour",
  knots: "1 knot",
  nmi: "1852 m",
  sqft: "1 ft^2",
}

export interface Compiled {
  node: MathNode
  code: EvalFunction
}

/** A mathjs instance with currencies for one set of rates, and the lines it has already compiled. */
export interface Instance {
  key: string
  math: MathJsInstance
  currencies: ReadonlySet<string>
  /** Whether currencies convert into one another. */
  hasRates: boolean
  compiled: Map<string, Compiled>
}

/** Above this many compiled lines the cache starts over, so a long session can't grow it without bound. */
const MAX_COMPILED = 5000

export function ratesKey(rates: ExchangeRates | undefined): string {
  return rates ? `${rates.base}@${rates.date}:${Object.keys(rates.rates).length}` : "none"
}

export function createInstance(rates: ExchangeRates | undefined): Instance {
  const math = create(all as FactoryFunctionMap, { number: "BigNumber", precision: 64 })
  for (const [name, definition] of Object.entries(EXTRA_UNITS)) {
    try {
      math.createUnit(name, definition)
    } catch {
      // Already known to mathjs: its own definition is fine.
    }
  }

  const currencies = new Set<string>()
  const define = (code: string, definition?: unknown) => {
    try {
      if (definition === undefined) math.createUnit(code)
      else math.createUnit(code, { definition: definition as string })
      currencies.add(code)
    } catch {
      // A code that clashes with a mathjs name is left to mathjs.
    }
  }
  if (rates) {
    define(rates.base)
    for (const [code, rate] of Object.entries(rates.rates)) {
      if (code === rates.base || !(rate > 0)) continue
      define(code, math.unit(math.divide(math.bignumber(1), math.bignumber(String(rate))) as never, rates.base))
    }
  }
  // Without a rate a currency is a dimension of its own: amounts in it add up, and mixing reports why.
  for (const code of COMMON_CURRENCIES) if (!currencies.has(code)) define(code)

  return { key: ratesKey(rates), math, currencies, hasRates: !!rates, compiled: new Map() }
}

export function compile(instance: Instance, source: string): Compiled {
  let entry = instance.compiled.get(source)
  if (!entry) {
    if (instance.compiled.size >= MAX_COMPILED) instance.compiled.clear()
    const node = instance.math.parse(source)
    entry = { node, code: node.compile() }
    instance.compiled.set(source, entry)
  }
  return entry
}
