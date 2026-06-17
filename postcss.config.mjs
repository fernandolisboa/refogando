/**
 * PostCSS — pipeline do Tailwind v4 (CSS-first). O plugin `@tailwindcss/postcss`
 * compila `@import "tailwindcss"` + o bloco `@theme` de src/app/globals.css.
 * Next 16 detecta este arquivo automaticamente; não precisa de tailwind.config.js
 * (a config vive no `@theme` do CSS).
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}

export default config
