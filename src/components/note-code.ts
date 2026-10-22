import { CodeBlock } from "@tiptap/extension-code-block"
import { createHighlightPlugin, type Parser } from "prosemirror-highlight"
import { createParser } from "prosemirror-highlight/shiki"
import type { BundledLanguage } from "shiki"
import { DUAL_THEMES, loadedHighlighter, loadHighlighterLanguage } from "@/lib/code"

/** Languages asked for so far: loaded (true) or unknown to Shiki (false). */
const languages = new Map<string, boolean>()

/**
 * Highlights with the same Shiki setup as code clips, so code looks the same in a note and on its own. Returning a
 * promise tells the plugin to try again once the highlighter or the language has loaded.
 */
const parser: Parser = (options) => {
  const highlighter = loadedHighlighter()
  const { language } = options
  if (!language) return []
  const known = languages.get(language)
  if (known === false) return []
  if (!highlighter || known === undefined) {
    return loadHighlighterLanguage(language).then(
      (ok) => void languages.set(language, ok),
      () => void languages.set(language, false),
    )
  }
  return createParser(highlighter, { lang: language as BundledLanguage, ...DUAL_THEMES })(options)
}

/** Code blocks in the editor, highlighted as you type. */
export const NoteCodeBlock = CodeBlock.extend({
  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), createHighlightPlugin({ parser, nodeTypes: ["codeBlock"] })]
  },
})
