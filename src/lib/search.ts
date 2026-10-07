import MiniSearch from "minisearch"
import { useMemo, useState } from "react"
import { type Clip, isFileClip } from "@/db/schema"
import { clipLabel } from "./format"

interface Doc {
  id: string
  label: string
  body: string
  kind: string
}

/** Indexing whole multi-megabyte pastes buys nothing; the head is what people search for. */
const MAX_BODY = 20_000

function toDoc(clip: Clip): Doc {
  return {
    id: clip.id,
    label: clipLabel(clip),
    body: isFileClip(clip) ? clip.file.name : clip.text.slice(0, MAX_BODY),
    kind: isFileClip(clip) ? `${clip.kind} ${clip.file.mime}` : `${clip.kind} ${clip.language ?? ""}`,
  }
}

function createIndex() {
  return new MiniSearch<Doc>({
    fields: ["label", "body", "kind"],
    searchOptions: { boost: { label: 3, kind: 0.5 }, prefix: true, fuzzy: 0.2, combineWith: "AND" },
  })
}

/** A search index patched incrementally, so edits don't trigger a full re-index. */
class ClipIndex {
  private index = createIndex()
  private versions = new Map<string, number>()

  sync(clips: readonly Clip[]) {
    const seen = new Set<string>()
    for (const clip of clips) {
      seen.add(clip.id)
      const version = this.versions.get(clip.id)
      if (version === clip.updatedAt) continue
      if (version === undefined) this.index.add(toDoc(clip))
      else this.index.replace(toDoc(clip))
      this.versions.set(clip.id, clip.updatedAt)
    }
    for (const id of this.versions.keys()) {
      if (seen.has(id)) continue
      this.index.discard(id)
      this.versions.delete(id)
    }
  }

  search(query: string): Set<string> {
    return new Set(this.index.search(query).map((r) => String(r.id)))
  }
}

/** Ids matching `query`, or null when there is no query. The index is only built once someone searches. */
export function useSearch(clips: readonly Clip[], query: string): Set<string> | null {
  const [index] = useState(() => ({ current: null as ClipIndex | null }))
  return useMemo(() => {
    const q = query.trim()
    if (!q) return null
    index.current ??= new ClipIndex()
    index.current.sync(clips)
    return index.current.search(q)
  }, [clips, query, index])
}
