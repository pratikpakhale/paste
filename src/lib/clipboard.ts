import { zip } from "fflate"
import type { ClipInput } from "@/db/actions"
import { getBlob } from "@/db/actions"
import { type Clip, type FileClip, isFileClip } from "@/db/schema"
import { blobToDataUrl, toPng } from "./media"
import { clipLabel } from "./format"

const MAX_HTML_BYTES = 512 * 1024
/** Images larger than this are left out of multi-clip HTML; data URLs that big make pastes hang. */
const MAX_INLINE_IMAGE_BYTES = 8 * 1024 * 1024

/**
 * Turns a paste or drop into clip inputs. Finder copies put the file names in text/plain next to
 * the files, and Office apps add an image rendition next to their text — so files only win when
 * the text is absent or just repeats their names.
 */
export function readTransfer(dt: DataTransfer): ClipInput[] {
  const files = [...dt.files]
  const text = dt.getData("text/plain")
  const html = dt.getData("text/html")
  const names = files.map((f) => f.name).join("\n")

  if (files.length && (!text.trim() || text.trim() === names.trim() || files.some((f) => !f.type.startsWith("image/")))) {
    return files.map((file) => ({ type: "file", file }))
  }
  if (text.trim()) {
    return [{ type: "text", text, html: html && html.length <= MAX_HTML_BYTES ? html : undefined }]
  }
  const uri = dt.getData("text/uri-list")
  if (uri.trim()) return [{ type: "text", text: uri.split("\n")[0]!.trim() }]
  if (html.trim()) {
    const plain = new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
    if (plain.trim()) return [{ type: "text", text: plain, html }]
  }
  return []
}

export function hasTransferContent(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return dt.types.some((t) => t === "Files" || t === "text/plain" || t === "text/uri-list" || t === "text/html")
}

function escapeHtml(text: string) {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

function linkHtml(url: string) {
  const href = escapeHtml(url.trim())
  return `<p><a href="${href}">${href}</a></p>`
}

async function clipToHtml(clip: Clip): Promise<string> {
  if (isFileClip(clip)) {
    if (clip.kind === "image" && clip.file.size <= MAX_INLINE_IMAGE_BYTES) {
      const blob = await getBlob(clip.blobId)
      if (blob) return `<p><img src="${await blobToDataUrl(blob)}" alt="${escapeHtml(clip.file.name)}"></p>`
    }
    return `<p>${escapeHtml(clip.file.name)}</p>`
  }
  if (clip.html) return clip.html
  if (clip.kind === "link") return linkHtml(clip.text)
  if (clip.kind === "code" || clip.kind === "json") return `<pre><code>${escapeHtml(clip.text)}</code></pre>`
  return `<p>${escapeHtml(clip.text).replaceAll("\n", "<br>")}</p>`
}

function clipToPlain(clip: Clip): string {
  return isFileClip(clip) ? clip.file.name : clip.text
}

export type CopyOutcome = "copied" | "download"

/**
 * Must be called synchronously from the user gesture: the ClipboardItem is built with promises so
 * the async blob reads happen after `write()` has already claimed the activation (Safari needs this).
 */
export async function copyClips(clips: Clip[], separator = "\n\n"): Promise<CopyOutcome> {
  const [first] = clips
  if (!first) return "copied"

  if (clips.length === 1) {
    if (isFileClip(first)) {
      if (first.kind !== "image") return "download"
      const png = getBlob(first.blobId).then((blob) => {
        if (!blob) throw new Error("Image data is missing")
        return toPng(blob)
      })
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })])
      return "copied"
    }
    const items: Record<string, Blob> = { "text/plain": new Blob([first.text], { type: "text/plain" }) }
    const html = first.html ?? (first.kind === "link" ? linkHtml(first.text) : undefined)
    if (html) items["text/html"] = new Blob([html], { type: "text/html" })
    await navigator.clipboard.write([new ClipboardItem(items)])
    return "copied"
  }

  const plain = clips.map(clipToPlain).join(separator)
  const html = Promise.all(clips.map(clipToHtml)).then((parts) => new Blob([parts.join("")], { type: "text/html" }))
  await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([plain], { type: "text/plain" }), "text/html": html })])
  return "copied"
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const TEXT_EXTENSION: Partial<Record<Clip["kind"], string>> = { markdown: "md", json: "json", code: "txt" }

async function clipFile(clip: Clip): Promise<{ name: string; data: Blob } | null> {
  if (isFileClip(clip)) {
    const blob = await getBlob(clip.blobId)
    return blob ? { name: clip.file.name, data: blob } : null
  }
  const label =
    (clip.title || clipLabel(clip))
      .replaceAll(/[\\/:*?"<>|\n]/g, " ")
      .slice(0, 60)
      .trim() || "clip"
  const ext = TEXT_EXTENSION[clip.kind] ?? "txt"
  return { name: /\.\w+$/.test(label) ? label : `${label}.${ext}`, data: new Blob([clip.text], { type: "text/plain" }) }
}

function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name
  for (let i = 2; taken.has(candidate); i++) candidate = name.replace(/(\.\w+)?$/, ` (${i})$1`)
  taken.add(candidate)
  return candidate
}

export function zipFiles(files: Record<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    // Media is already compressed; storing avoids burning CPU for nothing.
    zip(files, { level: 0 }, (err, data) => (err ? reject(err) : resolve(new Blob([data], { type: "application/zip" }))))
  })
}

export async function downloadClips(clips: Clip[]) {
  const files = (await Promise.all(clips.map(clipFile))).filter((f) => f !== null)
  const [only] = files
  if (!only) return
  if (files.length === 1) return downloadBlob(only.data, only.name)

  const taken = new Set<string>()
  const buffers = await Promise.all(files.map((file) => file.data.arrayBuffer()))
  const entries: Record<string, Uint8Array> = {}
  files.forEach((file, i) => (entries[uniqueName(file.name, taken)] = new Uint8Array(buffers[i]!)))
  downloadBlob(await zipFiles(entries), `paste-${clips.length}-clips.zip`)
}

export function isDownloadOnly(clip: Clip): clip is FileClip {
  return isFileClip(clip) && clip.kind !== "image"
}
