import type { FileKind, TextKind } from "@/db/schema"

const COLOR = /^(#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([^()]*\))$/i

const MARKDOWN_SIGNALS = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+\.\s+\S/m,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /^```/m,
  /^>\s/m,
  /\*\*[^*\n]+\*\*/,
  /^\|.+\|\s*$/m,
  /^\s*- \[[ x]\]\s/im,
]

const CODE_SIGNALS = [
  /[;{}]\s*$/m,
  /^\s*(?:import|export|from|const|let|var|function|def|class|return|if|for|while|package|use|fn|pub|func)\b/m,
  /=>|->|::|===|!==|&&|\|\|/,
  /^\s*(?:\/\/|#!|\/\*|<!--|--\s)/m,
  /^\s*<\/?[a-z][\w-]*(?:\s[^>]*)?>/im,
  /\b\w+\([^)]*\)\s*[{:]/,
]

export function isColor(text: string): boolean {
  return COLOR.test(text.trim())
}

export function isUrl(text: string): boolean {
  const value = text.trim()
  if (/\s/.test(value) || !URL.canParse(value)) return false
  return /^(?:https?|ftp|mailto|file):/i.test(value)
}

export function isJson(text: string): boolean {
  const value = text.trim()
  if (!/^[[{]/.test(value)) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function count(signals: RegExp[], text: string): number {
  return signals.reduce((n, signal) => n + (signal.test(text) ? 1 : 0), 0)
}

/**
 * Cheap, synchronous classification. Returns `code` only as a hint — the caller refines it with
 * real language detection, which may still decide the text is prose.
 */
export function classifyText(text: string): TextKind {
  const value = text.trim()
  if (!value) return "text"
  if (isColor(value)) return "color"
  if (isUrl(value)) return "link"
  if (isJson(value)) return "json"

  const markdown = count(MARKDOWN_SIGNALS, value)
  const code = count(CODE_SIGNALS, value)
  if (markdown >= 2 && markdown >= code) return "markdown"
  if (code >= 2) return "code"
  return "text"
}

export function classifyMime(mime: string): FileKind {
  if (mime.startsWith("image/")) return "image"
  if (mime.startsWith("video/")) return "video"
  if (mime.startsWith("audio/")) return "audio"
  if (mime === "application/pdf") return "pdf"
  return "file"
}

/** Extensions whose contents are better stored as an editable text clip than as an opaque file. */
const TEXT_EXTENSIONS: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  sql: "sql",
  css: "css",
  scss: "scss",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  xml: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  lua: "lua",
  dart: "dart",
  graphql: "graphql",
  dockerfile: "docker",
  diff: "diff",
}

export interface TextFileKind {
  kind: TextKind
  language?: string
}

export const MAX_TEXT_FILE_BYTES = 1024 * 1024

export function classifyTextFile(name: string, mime: string, size: number): TextFileKind | null {
  if (size > MAX_TEXT_FILE_BYTES) return null
  const ext = name.toLowerCase().split(".").pop() ?? ""
  if (ext === "md" || ext === "markdown" || mime === "text/markdown") return { kind: "markdown" }
  if (ext === "json" || mime === "application/json") return { kind: "json" }
  const language = TEXT_EXTENSIONS[ext]
  if (language) return { kind: "code", language }
  if (ext === "txt" || mime === "text/plain") return { kind: "text" }
  return null
}
