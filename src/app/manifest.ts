import type { MetadataRoute } from 'next'

// Manifest PWA (#270): convenção de arquivo do App Router → Next serve `/manifest.webmanifest`
// e injeta `<link rel="manifest">`. Vive em `src/app/` (acima de `[locale]`), como o icon.svg.
// `start_url: '/'` → o proxy redireciona pro locale (302), normal pra PWA. Ícones 192/512
// full-bleed creme com safe-zone (maskable), gerados a partir do símbolo "frigideira-lateral".
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Refogando',
    short_name: 'Refogando',
    description: 'App de receitas com IA.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FBF7EF',
    theme_color: '#FBF7EF',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
