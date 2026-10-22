import type { BundledLanguage, BundledTheme, HighlighterGeneric } from "shiki"

type Highlighter = HighlighterGeneric<BundledLanguage, BundledTheme>

const THEMES = { light: "github-light-default", dark: "github-dark-default" } as const

/** Above this size highlighting stalls the main thread for too little benefit. */
export const MAX_HIGHLIGHT_CHARS = 150_000

let highlighter: Promise<Highlighter> | undefined
let ready: Highlighter | undefined

function getHighlighter(): Promise<Highlighter> {
  return (highlighter ??= import("shiki").then(async ({ createHighlighter, createJavaScriptRegexEngine }) => {
    ready = await createHighlighter({
      themes: [THEMES.light, THEMES.dark],
      langs: [],
      engine: createJavaScriptRegexEngine(),
    })
    return ready
  }))
}

/** The highlighter once it has loaded, for code that must highlight synchronously (the note editor). */
export function loadedHighlighter(): Highlighter | undefined {
  if (!ready) void getHighlighter()
  return ready
}

/** Loads a language into the highlighter; resolves false if Shiki doesn't know it. */
export async function loadHighlighterLanguage(language: string): Promise<boolean> {
  const [hl, lang] = await Promise.all([getHighlighter(), resolveLanguage(language)])
  if (lang === "text") return false
  if (!hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(lang)
  return true
}

/** Highlighting options for both themes at once, switched by CSS (see index.css). */
export const DUAL_THEMES = { themes: THEMES, defaultColor: false } as const

export interface LanguageOption {
  id: string
  name: string
}

let languages: Promise<LanguageOption[]> | undefined

export function loadLanguages(): Promise<LanguageOption[]> {
  languages ??= import("shiki").then(({ bundledLanguagesInfo }) =>
    bundledLanguagesInfo.map(({ id, name }) => ({ id, name })).toSorted((a, b) => a.name.localeCompare(b.name)),
  )
  return languages
}

async function resolveLanguage(language: string | undefined): Promise<BundledLanguage | "text"> {
  if (!language) return "text"
  const { bundledLanguages } = await import("shiki")
  return language in bundledLanguages ? (language as BundledLanguage) : "text"
}

export async function highlight(code: string, language: string | undefined): Promise<string> {
  const [hl, lang] = await Promise.all([getHighlighter(), resolveLanguage(language)])
  if (lang !== "text" && !hl.getLoadedLanguages().includes(lang)) await hl.loadLanguage(lang)
  return hl.codeToHtml(code, { lang, ...DUAL_THEMES })
}

/** highlight.js and Shiki mostly share ids; these are the ones that don't line up. */
const HLJS_TO_SHIKI: Record<string, string> = {
  objectivec: "objective-c",
  vbnet: "vb",
  "php-template": "php",
  "python-repl": "python",
  plaintext: "text",
  shell: "shellscript",
  bash: "shellscript",
}

export interface DetectedLanguage {
  language: string
  isProse: boolean
}

/**
 * highlight.js' auto-detection is the most reliable offline detector for short snippets. Only the
 * common language set is loaded, and only when something actually looks like code.
 */
export async function detectLanguage(code: string): Promise<DetectedLanguage> {
  const { default: hljs } = await import("highlight.js/lib/common")
  const sample = code.length > 20_000 ? code.slice(0, 20_000) : code
  const result = hljs.highlightAuto(sample)
  const detected = result.language ?? "plaintext"
  const relevance = result.relevance / Math.max(1, sample.split("\n").length)
  const isProse = detected === "plaintext" || detected === "markdown" || result.relevance < 6 || relevance < 0.6
  let language = HLJS_TO_SHIKI[detected] ?? detected
  if (language === "xml" && /<(?:html|div|span|body|head|p|a)\b/i.test(sample)) language = "html"
  return { language, isProse }
}
