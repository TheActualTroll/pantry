import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/** Pantry light background: oklch(0.985 0.006 148) */
const pantryBackground = '#f4f9f6'

/** `DEPLOY_TARGET=node` builds the plain static client for the Node/Railway server. */
const nodeTarget = process.env.DEPLOY_TARGET === 'node'

export default defineConfig({
  build: nodeTarget ? { outDir: 'dist/client', emptyOutDir: true } : undefined,
  plugins: [
    tailwindcss(),
    react(),
    // After the framework plugin, per Cloudflare Vite plugin docs.
    ...(nodeTarget ? [] : [cloudflare()]),
    // Restrict PWA generation to the Vite client environment so Workbox
    // artifacts are not emitted into the Worker build output.
    ...VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      // Icons and public assets are picked up once via workbox.globPatterns.
      includeManifestIcons: false,
      manifest: {
        name: 'Pantry',
        short_name: 'Pantry',
        description: 'Shared household inventory and smart pantry companion.',
        lang: 'ro',
        display: 'standalone',
        orientation: 'portrait-primary',
        start_url: '/',
        scope: '/',
        theme_color: pantryBackground,
        background_color: pantryBackground,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      // Push + notification actions live in src/sw.ts. API traffic is never cached.
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
      // Normal Vite HMR stays unencumbered. Opt in with SW_DEV=true to test the SW.
      devOptions: {
        enabled: process.env.SW_DEV === 'true',
      },
    }).map((plugin) => ({
      ...plugin,
      applyToEnvironment(environment: { name: string }) {
        return environment.name === 'client'
      },
    })),
  ],
})
