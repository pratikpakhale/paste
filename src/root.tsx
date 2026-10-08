import { ThemeProvider } from "next-themes"
import { NuqsAdapter } from "nuqs/adapters/react"
import { StrictMode } from "react"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DataProvider } from "@/state/data-provider"
import { App } from "./app"

/** The whole app with its providers; shared by the entry point and the smoke tests. */
export function Root() {
  return (
    <StrictMode>
      <NuqsAdapter>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <TooltipProvider delayDuration={400}>
            <DataProvider>
              <App />
            </DataProvider>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </NuqsAdapter>
    </StrictMode>
  )
}
