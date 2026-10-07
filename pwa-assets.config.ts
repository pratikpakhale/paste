import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config"

// The tile colour; maskable and Apple icons are rendered full-bleed on it so the OS can do the rounding.
const TILE = "#5b55e0"

export default defineConfig({
  headLinkOptions: { preset: "2023" },
  preset: {
    ...minimal2023Preset,
    maskable: { sizes: [512], padding: 0, resizeOptions: { background: TILE } },
    apple: { sizes: [180], padding: 0, resizeOptions: { background: TILE } },
  },
  images: ["public/logo.svg"],
})
