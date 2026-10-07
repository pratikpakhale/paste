import { claimNoteBlobs, addNoteBlobs } from "@/db/actions"

/** Whether pasted HTML carries images or files that have to be stored with the note before it's inserted. */
export function needsAdoption(html: string): boolean {
  return /\bdata-blob=|<img\b[^>]*\bsrc\s*=\s*["']?data:/i.test(html)
}

async function dataUrlBlob(url: string): Promise<Blob | null> {
  try {
    return await (await fetch(url)).blob()
  } catch {
    return null
  }
}

/**
 * Makes the images and files in pasted HTML belong to the note. Ones copied from another note are shared
 * with it; inline data URLs (from other apps, or a note copied out of Paste) move into the blob store, so
 * the document only holds a reference.
 */
export async function adoptPastedMedia(noteId: string, html: string): Promise<string> {
  const dom = new DOMParser().parseFromString(html, "text/html")
  const referenced = [...dom.querySelectorAll<HTMLElement>("[data-blob]")]
  const claimed = new Set(
    await claimNoteBlobs(
      noteId,
      referenced.map((el) => el.dataset.blob!),
    ),
  )

  const inline: HTMLImageElement[] = []
  for (const el of referenced) {
    if (claimed.has(el.dataset.blob!)) continue
    // The original is gone (deleted, or copied from another browser profile); fall back to what the HTML itself carries.
    el.removeAttribute("data-blob")
    if (el instanceof HTMLImageElement) continue
    const name = el.dataset.name ?? el.textContent ?? ""
    el.replaceWith(Object.assign(dom.createElement("p"), { textContent: name }))
  }
  for (const img of dom.querySelectorAll("img")) {
    if (!img.dataset.blob && img.getAttribute("src")?.startsWith("data:")) inline.push(img)
  }

  const blobs = await Promise.all(inline.map((img) => dataUrlBlob(img.getAttribute("src")!)))
  const ids = await addNoteBlobs(
    noteId,
    blobs.filter((b) => b !== null),
  )
  let next = 0
  inline.forEach((img, i) => {
    if (!blobs[i]) return img.remove()
    img.dataset.blob = ids[next++]
    img.removeAttribute("src")
  })
  return dom.body.innerHTML
}
