# Paste

A local clipboard for everything you paste: text, code, links, colors, images, video, audio, PDFs and files. Organize clips into spaces, put them in your own order, and copy several back at once.

**[paste.pakhale.com](https://paste.pakhale.com)**

- **Fully local.** Clips live in your browser's IndexedDB. Nothing is uploaded, and it works offline as an installable PWA.
- **Your order.** Drag to reorder (or <kbd>⌥</kbd><kbd>↑</kbd> / <kbd>⌥</kbd><kbd>↓</kbd>). One global order is shared by every view, and dropping into the pinned block pins.
- **Multi-copy.** Copy a selection as one clip, joined by line, or one by one with <kbd>Q</kbd> then <kbd>↵</kbd> for each next item.
- **Keyboard-first.** <kbd>⌘</kbd><kbd>V</kbd> anywhere to capture, <kbd>J</kbd>/<kbd>K</kbd> to move, <kbd>⌘</kbd><kbd>K</kbd> for search and commands, <kbd>?</kbd> for everything else.
- **Backups.** Export and import the whole library as a zip.

## Development

```sh
mise install        # pins bun
bun install
bun run dev
bun run check       # typecheck, lint, format, knip, tests
```

Built with Vite, React 19, Tailwind v4, shadcn/ui, Dexie, dnd-kit and Shiki.
