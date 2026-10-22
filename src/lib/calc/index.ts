import type { Calc } from "./types"

/** A digit and something to do with it: text that might be a calculation. Cheap, so mathjs needn't load to ask. */
const DIGIT = /\d/
const OPERATION = /[-+*/^%×÷=]|[$€£₹¥]|\b(?:in|to|as|of|off|on|sqrt|sum|avg|min|max)\b|\w\(/i

export function looksLikeCalculation(text: string): boolean {
  return DIGIT.test(text) && OPERATION.test(text)
}

let calc: Promise<Calc> | undefined

/** The calculator, loaded on first use: mathjs is a large download that most sessions never need. */
export function loadCalc(): Promise<Calc> {
  calc ??= import("./engine").then(({ createCalc }) => createCalc())
  return calc
}
