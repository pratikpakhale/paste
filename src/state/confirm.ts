import { create } from "zustand"

interface ConfirmRequest {
  title: string
  description: string
  action: string
  resolve: (ok: boolean) => void
}

export const useConfirmState = create<{ request: ConfirmRequest | null }>(() => ({ request: null }))

/** Promise-based destructive-action confirmation, rendered by <ConfirmDialog />. */
export function confirm(options: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => useConfirmState.setState({ request: { ...options, resolve } }))
}
