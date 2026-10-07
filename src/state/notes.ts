import { useEffect, useState } from "react"
import { create } from "zustand"
import { type ClipInput, createNote, discardIfEmpty, locks, noteLockName } from "@/db/actions"
import { db } from "@/db/schema"
import { useUi } from "./ui"

/**
 * This tab's claim on its open note: a shared Web Lock, so other tabs can see the note is in use
 * (presence, and the startup sweep leaves it alone). The browser releases it if the tab dies.
 */
let lock: { id: string; granted: boolean; release: () => Promise<void> } | null = null

async function switchLock(id: string | null) {
  if (lock?.id === id) return
  const previous = lock
  lock = null
  await previous?.release()
  if (!id || !locks) return
  let released = false
  let release: (() => void) | undefined
  const current = {
    id,
    granted: false,
    release: async () => {
      released = true
      release?.()
      await done.catch(() => {})
    },
  }
  const done = locks.request(noteLockName(id), { mode: "shared" }, () => {
    current.granted = true
    // Let go straight away if the tab moved on before the browser granted it.
    return released ? undefined : new Promise<void>((resolve) => (release = resolve))
  })
  lock = current
}

let switching = Promise.resolve()

/** Moves the lock to another note, one switch at a time so quick changes can't leak a lock. */
function hold(id: string | null): Promise<void> {
  switching = switching.then(() => switchLock(id))
  return switching
}

void hold(useUi.getState().note)
useUi.subscribe((state, prev) => {
  if (state.note === prev.note) return
  const left = prev.note
  // A note left blank was never really a clip; drop it once this tab lets go of it.
  void (async () => {
    await hold(state.note)
    if (left) await discardIfEmpty(left)
  })()
})

/** Shows a note in Write. */
export function openNote(id: string) {
  const ui = useUi.getState()
  ui.setNote(id)
  ui.setView({ type: "write" })
}

/** Where a new note goes: the space being looked at, or the space of the note being written in. */
async function currentSpace(): Promise<string | null> {
  const { view, note } = useUi.getState()
  if (view.type === "space") return view.id
  if (view.type === "write" && note) return (await db.clips.get(note))?.spaceId ?? null
  return null
}

let creating: Promise<string> | null = null

/** Opens a fresh, blank note. Calls made while one is being created share it. */
export async function newNote(spaceId?: string | null): Promise<string> {
  creating ??= (async () => createNote(spaceId === undefined ? await currentSpace() : spaceId))().finally(() => (creating = null))
  const id = await creating
  openNote(id)
  return id
}

/** Back to this tab's note, or a new one if it's gone. */
export async function goWrite() {
  const id = useUi.getState().note
  const clip = id ? await db.clips.get(id) : undefined
  if (clip && clip.deletedAt === null) openNote(clip.id)
  else await newNote()
}

/**
 * Puts the tab on a note at launch: the one in its URL when it still exists (a reload), otherwise a
 * blank one. The installed app's "New note" shortcut launches with `?new`.
 */
export async function startSession() {
  const url = new URL(location.href)
  if (url.searchParams.has("new")) {
    url.searchParams.delete("new")
    history.replaceState(history.state, "", url)
    await newNote(null)
    return
  }
  const { view, note } = useUi.getState()
  if (view.type !== "write") return
  const clip = note ? await db.clips.get(note) : undefined
  if (!clip || clip.deletedAt !== null || clip.kind !== "note") await newNote(null)
}

const PRESENCE_POLL_MS = 2000

/** How many other tabs have this note open. */
export function useOtherTabs(id: string): number {
  const [others, setOthers] = useState(0)
  useEffect(() => {
    if (!locks) return
    const manager = locks
    let alive = true
    const check = async () => {
      const { held = [] } = await manager.query()
      const tabs = held.filter((l) => l.name === noteLockName(id)).length
      if (alive) setOthers(Math.max(0, tabs - (lock?.id === id && lock.granted ? 1 : 0)))
    }
    void check()
    const timer = setInterval(() => void check(), PRESENCE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id])
  return others
}

type Insert = (inputs: ClipInput[]) => void

let inserter: { id: string; insert: Insert } | null = null
/** Content for a note whose editor isn't up yet. `id` is null when the tab's note is still being created. */
let pending: { id: string | null; inputs: ClipInput[]; at: number } | null = null

/** A paste that waited longer than this for its editor was for a moment that has passed. */
const PENDING_TTL_MS = 5000

/** Write's editor takes what's pasted or dropped on the page around it. Returns the unregister function. */
export function acceptInserts(id: string, insert: Insert): () => void {
  const entry = { id, insert }
  inserter = entry
  if (pending && (pending.id === id || pending.id === null)) {
    const { inputs, at } = pending
    pending = null
    if (Date.now() - at < PENDING_TTL_MS) insert(inputs)
  }
  return () => {
    if (inserter === entry) inserter = null
  }
}

/** Puts pasted or dropped content into this tab's note. A note whose editor is still loading gets it once it's up. */
export function insertIntoNote(inputs: ClipInput[]) {
  if (!inputs.length) return
  const id = useUi.getState().note
  if (id && inserter?.id === id) inserter.insert(inputs)
  else pending = { id, inputs, at: Date.now() }
}

/** Notes with edits whose snapshot hasn't been written yet. The document itself is stored on every keystroke. */
const saving = create<{ ids: ReadonlySet<string> }>(() => ({ ids: new Set() }))

export function setSaving(id: string, on: boolean) {
  const { ids } = saving.getState()
  if (ids.has(id) === on) return
  const next = new Set(ids)
  if (on) next.add(id)
  else next.delete(id)
  saving.setState({ ids: next })
}

export const useSaving = (id: string) => saving((s) => s.ids.has(id))
