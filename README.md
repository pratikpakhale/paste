# Paste

A local clipboard for everything you paste: text, code, links, colors, images, video, audio, PDFs and files. Organize clips into spaces, put them in your own order, and copy several back at once.

**[paste.pakhale.com](https://paste.pakhale.com)**

- **Fully local.** Clips live in your browser's IndexedDB. Nothing is uploaded, and it works offline as an installable PWA. The one request Paste makes on its own is for the ECB's daily exchange rates, which you can turn off from <kbd>⌘</kbd><kbd>K</kbd>.
- **Your order.** Drag to reorder (or <kbd>⌥</kbd><kbd>↑</kbd> / <kbd>⌥</kbd><kbd>↓</kbd>). One global order is shared by every view, and dropping into the pinned block pins.
- **Multi-copy.** Tick clips (or <kbd>⌘</kbd><kbd>A</kbd>) and copy them as one clip, joined by line, or one by one with <kbd>Q</kbd> then <kbd>↵</kbd> for each next item.
- **Keyboard-first.** <kbd>⌘</kbd><kbd>V</kbd> anywhere to capture, <kbd>J</kbd>/<kbd>K</kbd> to move, <kbd>⌘</kbd><kbd>K</kbd> for search and commands, <kbd>?</kbd> for everything else.
- **Notes.** Type <kbd>/</kbd> for headings, lists, to-dos, toggles, tables, code and calculations; select text to format it or add a link. Code is highlighted as you type, and blocks drag to reorder.
- **Notes that do math.** A calculation block works out every line beside it: names (`rent = 2,100`), `sum` and `subtotal`, `20% of 85`, units (`1.5 l in ml`, `12 V * 2 A`) and currencies (`100 USD in INR`). A line of any note that is a calculation (`20% of 85`, `Rent: 2,100 * 12`) shows its answer too; mid-sentence, end it with `=`. Press <kbd>Tab</kbd> to write the answer in. Click an answer to copy it. <kbd>⌘</kbd><kbd>K</kbd> works sums out too, and selecting clips that are amounts shows their total.
- **Backups.** Export and import the whole library as a zip.

## Development

```sh
mise install        # pins bun
bun install
bun run dev
bun run check       # typecheck, lint, format, knip, tests
```

Built with Vite, React 19, Tailwind v4, shadcn/ui, Dexie, dnd-kit, Tiptap, Shiki and mathjs.
