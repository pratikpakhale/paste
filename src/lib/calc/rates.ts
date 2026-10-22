import type { ExchangeRates } from "./types"

/** The European Central Bank's daily reference rates. Free, keyless, and only the request itself is sent. */
const RATES_URL = "https://api.frankfurter.dev/v1/latest?base=EUR"
const STORAGE_KEY = "paste:rates"

interface Stored {
  rates: ExchangeRates
  /** The local day they were fetched; the ECB publishes once a working day, so once a day is plenty. */
  fetchedOn: string
}

const localDay = (date = new Date()) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`

function read(): Stored | undefined {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null") as Stored | null
    return stored?.rates?.base && stored.rates.rates ? stored : undefined
  } catch {
    return undefined
  }
}

/** The last rates fetched, if any, without waiting. */
export function cachedRates(): ExchangeRates | undefined {
  return read()?.rates
}

let pending: Promise<ExchangeRates | undefined> | undefined

/** Today's rates: from the cache when fetched today, otherwise fetched. Offline, the last ones fetched. */
export function getRates(): Promise<ExchangeRates | undefined> {
  const stored = read()
  if (stored?.fetchedOn === localDay()) return Promise.resolve(stored.rates)
  pending ??= fetchRates(stored).finally(() => (pending = undefined))
  return pending
}

async function fetchRates(stored: Stored | undefined): Promise<ExchangeRates | undefined> {
  try {
    const response = await fetch(RATES_URL)
    if (!response.ok) return stored?.rates
    const body = (await response.json()) as { base?: string; date?: string; rates?: Record<string, number> }
    if (!body.base || !body.date || !body.rates) return stored?.rates
    const rates: ExchangeRates = { base: body.base, date: body.date, rates: { ...body.rates, [body.base]: 1 } }
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ rates, fetchedOn: localDay() } satisfies Stored))
    return rates
  } catch {
    return stored?.rates
  }
}
