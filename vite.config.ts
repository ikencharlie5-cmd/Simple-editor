import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 1500 },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Chiken',
        short_name: 'Chiken',
        description: 'Photo, video, audio and animation editor that runs in your browser.',
        theme_color: '#16161d',
        background_color: '#16161d',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: ['**/transformers*.js', '**/ort*.js'],
        runtimeCaching: [
          { urlPattern: /\/(mediapipe|models)\//, handler: 'CacheFirst', options: { cacheName: 'chiken-ai', expiration: { maxEntries: 20 } } },
          { urlPattern: /huggingface\.co|hf\.co|cdn\.jsdelivr\.net/, handler: 'CacheFirst', options: { cacheName: 'chiken-speech', expiration: { maxEntries: 60 } } },
        ],
      },
    }),
  ],
})
