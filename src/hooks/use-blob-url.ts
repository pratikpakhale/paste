import { useLiveQuery } from "dexie-react-hooks"
import { useEffect, useState } from "react"
import { db } from "@/db/schema"

/** Object URL for a stored blob, revoked when the component unmounts or the blob changes. */
export function useBlobUrl(id: string | undefined): string | undefined {
  const blob = useLiveQuery(async () => (id ? (await db.blobs.get(id))?.blob : undefined), [id])
  const [url, setUrl] = useState<{ blob: Blob; url: string }>()

  useEffect(() => {
    if (!blob) return
    const next = { blob, url: URL.createObjectURL(blob) }
    // Object URLs are an external resource: created and revoked with the effect, so StrictMode's
    // double-run can't revoke a URL that is still rendered.
    // oxlint-disable-next-line react/set-state-in-effect
    setUrl(next)
    return () => URL.revokeObjectURL(next.url)
  }, [blob])

  // Never hand out a URL belonging to a previous blob while the new one is being created.
  return url && url.blob === blob ? url.url : undefined
}
