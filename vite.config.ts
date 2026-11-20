import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.png', 'favicon.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'A2Z Order Pad',
        short_name: 'Orders',
        description: 'Store order taking for A2Z Beverage Distributors products',
        theme_color: '#1e3a8a',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // precache everything, including the lazily loaded PDF tools, so the app works offline
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        // optional jsPDF helpers that this app never uses
        globIgnores: ['**/html2canvas-*.js', '**/purify.es-*.js'],
      },
    }),
  ],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(`${pkg.version} · built ${new Date().toISOString().slice(0, 10)}`) },
  build: { target: 'es2020', chunkSizeWarningLimit: 2000 },
});
