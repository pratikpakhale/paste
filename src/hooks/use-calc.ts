import { useEffect, useMemo, useReducer } from "react"
import { looksLikeCalculation } from "@/lib/calc"
import type { CalcResult, Summary } from "@/lib/calc/types"
import { calcOptions, currentCalc, ensureCalc, onCalcChange } from "@/state/calc"

type Value = Extract<CalcResult, { kind: "value" }>

const DIGIT = /\d/

/** Re-renders when answers can change: the calculator loaded, rates arrived, settings changed. */
function useCalcVersion(wanted: boolean): number {
  const [version, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => onCalcChange(bump), [])
  useEffect(() => {
    if (wanted) void ensureCalc()
  }, [wanted])
  return version
}

/** The answer to a typed calculation, for the command palette. */
export function useCalcAnswer(text: string): Value | null {
  const query = text.trim()
  const wanted = query.length > 1 && looksLikeCalculation(query)
  const version = useCalcVersion(wanted)
  return useMemo(() => {
    const calc = currentCalc()
    if (!wanted || !calc) return null
    return calc.evaluateOne(query, calcOptions())
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the calculator and its options.
  }, [query, wanted, version])
}

/** A short clip that could be an amount: `42`, `₹1,200`, `3.5 kg`. Anything longer is prose. */
const AMOUNT = /^[^\n]{1,40}$/

/** Count, sum and average of texts that are all amounts; `null` if any isn't. */
export function useAmountsSummary(texts: readonly string[]): Summary | null {
  const wanted = texts.length > 1 && texts.every((t) => AMOUNT.test(t.trim()) && DIGIT.test(t))
  const version = useCalcVersion(wanted)
  return useMemo(() => {
    const calc = currentCalc()
    if (!wanted || !calc) return null
    const options = calcOptions()
    const values: Value[] = []
    for (const text of texts) {
      const value = calc.value(text.trim(), options)
      if (!value) return null
      values.push(value)
    }
    const summary = calc.summarize(values, options)
    return summary.sum ? summary : null
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `version` stands for the calculator and its options.
  }, [texts, wanted, version])
}
