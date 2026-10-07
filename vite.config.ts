import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type Plugin } from "vite"
import { VitePWA } from "vite-plugin-pwa"

const SITE_URLS_MARKER = /\n\s*<!-- site-urls:[^>]*-->/

const attr = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")

/**
 * Canonical and Open Graph URLs must be absolute, so they only exist once the deploy origin is
 * known. Without SITE_URL the marker is simply removed rather than emitting broken relative URLs.
 */
function siteUrls(siteUrl: string | undefined): Plugin {
  const origin = siteUrl?.replace(/\/+$/, "")
  const tags = origin
    ? [
        `<link rel="canonical" href="${attr(origin)}/" />`,
        `<meta property="og:url" content="${attr(origin)}/" />`,
        `<meta property="og:image" content="${attr(origin)}/og.png" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        `<meta property="og:image:alt" content="Paste: a list of clips — a color, a shell command, notes, a link and a screenshot." />`,
        `<meta name="twitter:image" content="${attr(origin)}/og.png" />`,
      ]
        .map((tag) => `\n    ${tag}`)
        .join("")
    : ""
  return {
    name: "paste:site-urls",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace(SITE_URLS_MARKER, tags),
    },
  }
}

/** The Latin cuts of Geist and Geist Mono: what every first paint needs. */
const PRELOAD_FONT = /(?:^|\/)geist(?:-mono)?-latin-wght-normal-[\w-]+\.woff2$/

/**
 * Fontsource declares `font-display: swap`, so a font that arrives after first paint re-flows the whole UI.
 * Preloading the hashed Latin files lets them land before the first layout instead.
 */
function preloadFonts(): Plugin {
  return {
    name: "paste:preload-fonts",
    transformIndexHtml: {
      order: "post",
      handler: (_html, { bundle }) =>
        Object.keys(bundle ?? {})
          .filter((file) => PRELOAD_FONT.test(file))
          .map((file) => ({
            tag: "link",
            attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
            injectTo: "head" as const,
          })),
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "")
  return {
    plugins: [
      react(),
      tailwindcss(),
      siteUrls(env.SITE_URL),
      preloadFonts(),
      VitePWA({
        registerType: "autoUpdate",
        // index.html declares per-scheme theme colours; the generated single one would override them.
        pwaAssets: { config: true, overrideManifestIcons: true, injectThemeColor: false },
        manifest: {
          id: "/",
          name: "Paste",
          short_name: "Paste",
          description: "A local clipboard for everything you paste: text, code, images and files, organized and offline.",
          lang: "en",
          dir: "ltr",
          categories: ["productivity", "utilities"],
          theme_color: "#0c0c0e",
          background_color: "#0c0c0e",
          display: "standalone",
          start_url: "/",
          scope: "/",
          shortcuts: [{ name: "New clip", short_name: "New", url: "/?new" }],
        },
        workbox: {
          // Everything, including lazily-loaded Shiki grammars, so the app works fully offline.
          globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2,wasm}"],
          maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        },
      }),
    ],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "./src") },
    },
  }
})
