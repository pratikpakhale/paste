import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { cachedRates, getRates } from "./rates"

const realFetch = globalThis.fetch
const body = { base: "EUR", date: "2026-10-21", rates: { USD: 1.08, INR: 90.1 } }

beforeEach(() => localStorage.clear())
afterEach(() => {
  globalThis.fetch = realFetch
})

const respond = (response: () => Promise<Response>) => {
  const fetchMock = mock(response)
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

describe("getRates", () => {
  test("fetches once a day and caches", async () => {
    const fetchMock = respond(async () => Response.json(body))
    const rates = await getRates()
    expect(rates).toEqual({ base: "EUR", date: "2026-10-21", rates: { USD: 1.08, INR: 90.1, EUR: 1 } })
    expect(cachedRates()).toEqual(rates)
    await getRates()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("concurrent callers share one request", async () => {
    const fetchMock = respond(async () => Response.json(body))
    await Promise.all([getRates(), getRates()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test("offline keeps the last rates, and never throws", async () => {
    localStorage.setItem("paste:rates", JSON.stringify({ rates: { ...body, rates: { USD: 1 } }, fetchedOn: "2000-1-1" }))
    respond(() => Promise.reject(new TypeError("Failed to fetch")))
    expect(await getRates()).toMatchObject({ rates: { USD: 1 } })
  })

  test("nothing cached and offline is undefined", async () => {
    respond(async () => new Response("nope", { status: 503 }))
    expect(await getRates()).toBeUndefined()
    expect(cachedRates()).toBeUndefined()
  })
})
