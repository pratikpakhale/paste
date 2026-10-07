import { createCn } from "cn/config"

/** Knows the app's type scale (index.css `--text-*`), so `text-caption` merges as a size rather than a color. */
export const cn = createCn({ extend: { theme: { text: ["micro", "caption", "detail", "title"] } } })
