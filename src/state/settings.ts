import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { NumberFormat } from "@/lib/calc/types"

/** Preferences that change what the app does, as opposed to how a view is arranged (./ui). */
interface SettingsState {
  /** Fetch the ECB's daily exchange rates for currency conversion. The only request Paste makes on its own. */
  currencyRates: boolean
  numberFormat: NumberFormat
  /** Answer any line of a note that is a calculation; off, only lines ending in `=` answer. */
  autoAnswers: boolean

  setCurrencyRates: (on: boolean) => void
  setNumberFormat: (format: NumberFormat) => void
  setAutoAnswers: (on: boolean) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      currencyRates: true,
      numberFormat: "auto",
      autoAnswers: true,
      setCurrencyRates: (currencyRates) => set({ currencyRates }),
      setNumberFormat: (numberFormat) => set({ numberFormat }),
      setAutoAnswers: (autoAnswers) => set({ autoAnswers }),
    }),
    {
      name: "paste:settings",
      version: 1,
      partialize: ({ currencyRates, numberFormat, autoAnswers }) => ({ currencyRates, numberFormat, autoAnswers }),
    },
  ),
)
