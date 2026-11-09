import { defineConfig, type Preset } from '@vite-pwa/assets-generator/config'

// Brand background used behind the icon where the platform needs an opaque image
// (maskable icon safe zone, iOS home screen). Matches the manifest theme_color.
const BRAND_BACKGROUND = '#1f6feb'

// Based on the minimal-2023 preset, without the unused 64x64 icon.
// Generates: pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png,
// apple-touch-icon-180x180.png and favicon.ico (48x48).
const preset: Preset = {
  transparent: {
    sizes: [192, 512],
    favicons: [[48, 'favicon.ico']],
  },
  maskable: {
    sizes: [512],
    resizeOptions: { background: BRAND_BACKGROUND },
  },
  apple: {
    sizes: [180],
    resizeOptions: { background: BRAND_BACKGROUND },
  },
}

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset,
  images: ['public/icon.svg'],
})
