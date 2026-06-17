/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Restricao } from '@/domain/vocabulary'
import type { Messages } from './pt-BR'

export const enUS: Messages = {
  app: { name: 'Refogando', tagline: 'AI recipes, in pt-BR and en-US' },
  nav: { home: 'Home', recipes: 'Recipes', signIn: 'Sign in', signOut: 'Sign out' },
  locale: { label: 'Language', ptBR: 'Portuguese (Brazil)', enUS: 'English (US)' },
  system: {
    loading: 'Loading…',
    error: 'Something went wrong.',
    notFound: 'Not found.',
    retry: 'Try again',
  },
  // Aviso de restrição (#7): mesma substância traduzida (ADR-0001), não byte-idêntica.
  // Placeholders {restricao}/{alergeno} idênticos ao pt-BR (interpolação compartilhada).
  aviso: {
    contradicao: 'Marked {restricao}, but contains {alergeno} — declared, not verified.',
  },
  // Ciclo de vida da tradução (#23, AC3): mesma substância traduzida (ADR-0001, não
  // byte-idêntica). Renderizados na vista no requestLocale (aviso de stale + ver-original).
  traducao: {
    staleAviso: 'This translation may be out of date compared to the original.',
    verOriginal: 'View the original',
  },
  // Rótulo amigável por valor do enum RESTRICOES (#7), traduzido por locale.
  // `satisfies Record<Restricao, string>` trava drift do enum no site de definição.
  restricaoLabel: {
    sem_gluten: 'gluten-free',
    sem_lactose: 'lactose-free',
    vegano: 'vegan',
    vegetariano: 'vegetarian',
    sem_acucar: 'sugar-free',
    low_carb: 'low carb',
    sem_oleaginosas: 'nut-free',
    sem_frutos_do_mar: 'shellfish-free',
  } satisfies Record<Restricao, string>,
} as const
