import { create } from "zustand"
import { loadCalc } from "@/lib/calc"
import { cachedRates, getRates } from "@/lib/calc/rates"
import type { Calc, CalcOptions, Summary } from "@/lib/calc/types"
import { useSettings } from "./settings"

/**
 * The calculator as the app uses it: loaded the first time something needs it, with the user's number format and
 * (when allowed) today's exchange rates. Anything showing answers listens for changes to either and recalculates.
 */
let engine: Calc | null = null
let loading: Promise<Calc> | null = null
const listeners = new Set<() => void>()

function changed() {
  for (const listener of listeners) listener()
}

/** The calculator if it has loaded; `null` means call `ensureCalc` and wait for a change. */
export function currentCalc(): Calc | null {
  return engine
}

export function ensureCalc(): Promise<Calc> {
  loading ??= loadCalc().then((calc) => {
    engine = calc
    refreshRates()
    changed()
    return calc
  })
  return loading
}

/** Called when answers may have changed: the calculator loaded, rates arrived, or a setting changed. */
export function onCalcChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function calcOptions(): CalcOptions {
  const { currencyRates, numberFormat, autoAnswers } = useSettings.getState()
  return { numberFormat, rates: currencyRates ? cachedRates() : undefined, proseAnswers: autoAnswers ? "auto" : "explicit" }
}

let fetching = false

function refreshRates() {
  if (fetching || !useSettings.getState().currencyRates) return
  fetching = true
  void getRates()
    .then((rates) => rates && changed())
    .finally(() => (fetching = false))
}

useSettings.subscribe((state, prev) => {
  if (state.currencyRates === prev.currencyRates && state.numberFormat === prev.numberFormat && state.autoAnswers === prev.autoAnswers)
    return
  if (engine) refreshRates()
  changed()
})

/** What the selected lines of each note add up to, for its footer. */
export const useCalcSummary = create<{ byNote: Record<string, Summary | undefined> }>()(() => ({ byNote: {} }))

export function setCalcSummary(noteId: string, summary: Summary | undefined) {
  const current = useCalcSummary.getState().byNote[noteId]
  if (current === summary || (current && summary && JSON.stringify(current) === JSON.stringify(summary))) return
  useCalcSummary.setState(({ byNote }) => ({ byNote: { ...byNote, [noteId]: summary } }))
}
