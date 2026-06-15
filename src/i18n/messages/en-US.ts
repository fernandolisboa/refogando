/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Messages } from './pt-BR'

export const enUS: Messages = {
  app: { name: 'Refogando', tagline: 'AI recipes, in pt-BR and en-US' },
  nav: { home: 'Home', recipes: 'Recipes', signIn: 'Sign in', signOut: 'Sign out' },
  locale: { label: 'Language', ptBR: 'Portuguese (Brazil)', enUS: 'English (US)' },
  system: { loading: 'Loading…', error: 'Something went wrong.', notFound: 'Not found.' },
} as const
