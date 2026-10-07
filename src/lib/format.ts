import { type Clip, isFileClip } from "@/db/schema"

const KIND_LABEL: Record<Clip["kind"], string> = {
  text: "Text",
  markdown: "Markdown",
  code: "Code",
  json: "JSON",
  link: "Link",
  color: "Color",
  image: "Image",
  video: "Video",
  audio: "Audio",
  pdf: "PDF",
  file: "File",
}

export function kindLabel(kind: Clip["kind"]): string {
  return KIND_LABEL[kind]
}

function firstLine(text: string): string {
  for (const line of text.split("\n")) {
    const trimmed = line.trim().replace(/^#+\s+/, "")
    if (trimmed) return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed
  }
  return "Empty"
}

/** What a clip is called when the user hasn't titled it. */
export function clipLabel(clip: Clip): string {
  if (clip.title) return clip.title
  if (isFileClip(clip)) return clip.file.name
  if (clip.kind === "link")
    return clip.text
      .trim()
      .replace(/^https?:\/\/(www\.)?/, "")
      .replace(/\/$/, "")
  return firstLine(clip.text)
}

/** Index where a file name's extension starts (at its dot), or the length when it has none. Dotfiles have no extension. */
export function extensionStart(name: string): number {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? dot : name.length
}

/**
 * The file name a rename resolves to. Path separators are replaced, an empty name keeps the old one,
 * and leaving the extension off keeps the old extension, so renaming `IMG_01.png` to `Receipt` gives `Receipt.png`.
 */
export function resolveFileName(input: string, current: string): string {
  const name = input.replaceAll(/[/\\]/g, "-").trim()
  if (!name) return current
  const extension = current.slice(extensionStart(current))
  return extension && extensionStart(name) === name.length ? `${name}${extension}` : name
}

/** Secondary text shown next to the label in the list. */
export function clipDetail(clip: Clip): string {
  if (isFileClip(clip)) {
    const { width, height, duration, size } = clip.file
    const parts = [formatBytes(size)]
    if (width && height) parts.unshift(`${width}×${height}`)
    if (duration) parts.unshift(formatDuration(duration))
    return parts.join(" · ")
  }
  if (clip.kind === "code" && clip.language) return clip.language
  const lines = clip.text.split("\n").length
  return lines > 1 ? `${lines} lines` : `${clip.text.length} chars`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

export function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" })
const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" })
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

export function formatAgo(timestamp: number, now = Date.now()): string {
  const seconds = Math.round((timestamp - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return "now"
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute")
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour")
  if (abs < 604_800) return relative.format(Math.round(seconds / 86_400), "day")
  return shortDate.format(timestamp)
}

export function formatDate(timestamp: number): string {
  return fullDate.format(timestamp)
}

export function clipSize(clip: Clip): number {
  return isFileClip(clip) ? clip.file.size : new Blob([clip.text]).size
}
