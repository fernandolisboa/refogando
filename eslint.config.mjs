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
]

export default eslintConfig
