import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { pagesBasePath } from './pagesBasePath';

// Build id shown in the app: GitLab pipeline IID in CI, 'local' otherwise.
const buildId = process.env.CI_PIPELINE_IID || 'local';

// The dev server injects an inline React refresh preamble and inline <style> tags, which the
// strict CSP meta in index.html blocks. Remove the CSP meta in `vite dev` only; `vite build`
// and `vite preview` serve index.html with the CSP unchanged.
const CSP_META = /\s*<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

function stripCspInDev(): Plugin {
  return {
    name: 'achievement-tracker:strip-csp-in-dev',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replace(CSP_META, ''),
    },
  };
}

export default defineConfig({
  base: pagesBasePath(process.env),
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    stripCspInDev(),
    react(),
    VitePWA({
      // autoUpdate: a new App_Version activates and reloads on the next launch
      // without a prompt. Chosen for this single-user PWA so deploys refresh
      // cleanly and never get stuck behind a cached worker (deviates from the
      // design's prompt-mode Req 10.9–10.11; UpdatePrompt stays wired but its
      // needRefresh never fires under autoUpdate, so no prompt is shown).
      registerType: 'autoUpdate',
      // Registration happens in the bundle via useRegisterSW (no inline script, CSP-friendly).
      injectRegister: false,
      // <link rel="manifest" crossorigin="use-credentials"> so the manifest loads behind GitLab Pages auth.
      useCredentials: true,
      // Public icons are already precached by workbox.globPatterns below; adding them again via
      // includeAssets / manifest icons would only produce duplicate precache entries.
      includeManifestIcons: false,
      manifest: {
        name: 'Achievement Tracker',
        short_name: 'Achievements',
        description: 'Track daily values for your activities and follow weekly and monthly goals.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#1f6feb',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache every build asset so the Tracker runs fully offline (Req 10.5, 10.6).
        // manifest.webmanifest is added to the precache by the plugin itself.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        navigateFallback: 'index.html',
        // Only deletes old Workbox caches; IndexedDB data is never touched (Req 10.12).
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
