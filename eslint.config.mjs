import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

// Next 16 + ESLint 9: flat config NATIVO do eslint-config-next (sem FlatCompat).
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'next-env.d.ts',
      'drizzle/**',
      // Espelho LOCAL read-only do protótipo do Claude Design (JSX standalone com React/
      // RecipeCard globais) — referência de design, não código do app; não lintar.
      'docs/design-prototype/**',
    ],
  },
  {
    // Testes de UI (jsdom) usam `<a href="/...">` como FIXTURE de `asChild` (Badge/Button) —
    // não é navegação real do app. Com o app embrulhado em `[locale]` (ADR-0020, #228), o
    // segmento dinâmico na RAIZ faz o `no-html-link-for-pages` casar qualquer path de 1
    // segmento como "página" e dispara um falso-positivo nesses fixtures. Desligar a regra SÓ
    // no seam de teste (onde não há roteador Next) mantém ela valendo no código do app.
    files: ['test/**'],
    rules: {
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
]

export default eslintConfig
