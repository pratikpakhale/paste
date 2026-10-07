import { useEffect, useState } from "react"

export interface StorageInfo {
  usage: number
  quota: number
  persisted: boolean
}

/** Storage usage, refreshed whenever `revision` changes (pass something that changes with the data). */
export function useStorage(revision: unknown): StorageInfo | null {
  const [info, setInfo] = useState<StorageInfo | null>(null)

  useEffect(() => {
    // Only exposed in secure contexts.
    if (!("storage" in navigator)) return
    let cancelled = false
    const load = async () => {
      const [estimate, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()])
      if (!cancelled) setInfo({ usage: estimate.usage ?? 0, quota: estimate.quota ?? 0, persisted })
    }
    void load()
    return () => {
      cancelled = true
    }
    // `revision` is the refresh trigger itself; the effect has no other inputs.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [revision])

  return info
}
