import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' reloads the page the instant it detects a newer deployed
      // version, with no regard for what the user is doing at that moment —
      // this was silently wiping in-progress Google sign-in (and could just
      // as easily interrupt a checkout) whenever a deploy happened while
      // someone had the app open. 'prompt' installs the new version in the
      // background and lets it activate naturally next time every tab for
      // this site is closed, instead of forcing a reload mid-session. No
      // "update available" UI is wired up for it (not worth the complexity
      // for this app) — the existing "fully close and reopen" habit already
      // picks up new deploys.
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Averia Jewellery',
        short_name: 'Averia',
        description: 'Averia Jewellery — inventory, invoicing and sales management.',
        // HashRouter means the real client-side route lives after the '#',
        // which start_url can't include — the app always boots at '/' and
        // App.jsx's own redirect (based on the signed-in user's role) takes
        // it from there.
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f5f7fb',
        theme_color: '#c19a5a',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      // Precaches the built app shell so it opens (and shows something
      // meaningful, not a browser offline page) even with a flaky connection
      // — this is a jewellery counter app, not something meant to run fully
      // offline, so live Firestore/Storage/Functions calls are deliberately
      // left uncached here rather than reached for via a runtime caching
      // strategy that could serve stale inventory/pricing data.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // logo.png is only ever used as the browser-tab favicon (a plain
        // network fetch, not something the SW needs to serve offline) — at
        // 1.8MB it would roughly double the precache size for no benefit.
        // The small pwa-*/maskable icons used for the installed app icon are
        // still precached normally.
        globIgnores: ['logo.png'],
        // /__/* is Firebase's own reserved path space (auth handler, hosting
        // internals) — it lives on the SAME origin as this app's authDomain
        // (averia-jewelry.firebaseapp.com also serves this exact SPA, so a
        // service worker ends up registered there too). Without this
        // denylist, the SW's SPA fallback hijacks navigations to
        // /__/auth/handler and serves our own cached index.html instead of
        // letting Firebase's real handler page run — which is what actually
        // completes a Google sign-in redirect/popup and relays the result
        // back. That hijack was the true cause of sign-in hanging on
        // "Loading…" no matter which sign-in method was used.
        navigateFallbackDenylist: [/^\/__\//]
      }
    })
  ],
  server: { port: 5173 },
  build: { outDir: 'dist' }
});
