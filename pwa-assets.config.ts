import { defineConfig, type Preset } from '@vite-pwa/assets-generator/config'

// Brand background used behind the icon where the platform needs an opaque image
// (maskable icon safe zone, iOS home screen). The source icon is already a
// full-bleed dark-green square, so this only shows if a platform adds padding;
// it matches the icon's background field.
const BRAND_BACKGROUND = '#13331f'

// Based on the minimal-2023 preset, without the unused 64x64 icon.
// Generates: pwa-192x192.png, pwa-512x512.png, maskable-icon-512x512.png,
// apple-touch-icon-180x180.png and favicon.ico (48x48).
//
// The source is already a full-bleed square with the "A" inside a generous
// safe zone, so padding is 0: the artwork fills each canvas edge-to-edge and
// the platform (iOS squircle, Android mask) clips it, rather than the generator
// shrinking the art and showing a nested rounded square.
const preset: Preset = {
  transparent: {
    sizes: [192, 512],
    favicons: [[48, 'favicon.ico']],
    padding: 0,
  },
  maskable: {
    sizes: [512],
    padding: 0,
    resizeOptions: { background: BRAND_BACKGROUND },
  },
  apple: {
    sizes: [180],
    padding: 0,
    resizeOptions: { background: BRAND_BACKGROUND },
  },
}

export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset,
  // Source is the cropped "A" artwork (full-bleed green PNG, white margin removed).
  // Kept outside public/ so the large source is not published or precached.
  images: ['assets/icon-source.png'],
})
