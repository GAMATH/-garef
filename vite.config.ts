/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Kuzuri',
        short_name: 'Kuzuri',
        description: 'Votre beauté, réservée en un instant.',
        lang: 'fr',
        theme_color: '#C4532D',
        background_color: '#FAF7F2',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('tile.openstreetmap.org'),
            handler: 'CacheFirst',
            options: { cacheName: 'map-tiles', expiration: { maxEntries: 200, maxAgeSeconds: 7 * 86400 } },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/'),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'api', expiration: { maxEntries: 300, maxAgeSeconds: 86400 } },
          },
        ],
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/leaflet')) return 'leaflet';
        },
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
