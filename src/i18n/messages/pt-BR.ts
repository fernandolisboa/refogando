/**
 * Catálogo de chrome em pt-BR (issue #4). `Messages = typeof ptBR` ancora o shape;
 * o en-US DEVE ter exatamente as mesmas chaves (teste de paridade T3 garante).
 */
import type { Restricao } from '@/domain/vocabulary'

export const ptBR = {
  app: { name: 'Refogando', tagline: 'Receitas com IA, em pt-BR e en-US' },
  nav: { home: 'Início', recipes: 'Receitas', signIn: 'Entrar', signOut: 'Sair' },
  locale: { label: 'Idioma', ptBR: 'Português (Brasil)', enUS: 'Inglês (EUA)' },
  system: {
    loading: 'Carregando…',
    error: 'Algo deu errado.',
    notFound: 'Não encontrado.',
    retry: 'Tentar de novo',
  },
  // Aviso de restrição (#7): template interpolado por `String.replace` ({restricao}/{alergeno}),
  // sem ICU. `mensagem` nasce na vista, renderizada no requestLocale.
  aviso: {
    contradicao: 'Marcada como {restricao}, mas contém {alergeno} — declarado, não verificado.',
  },
  // Ciclo de vida da tradução (#23, AC3): aviso leve de tradução obsoleta + rótulo
  // "ver o original". Renderizados na vista (recipe-read.ts) no requestLocale — só
  // quando a tradução pedida é stale E difere da origem (a origem nunca é sinalizada).
  traducao: {
    staleAviso: 'Esta tradução pode estar desatualizada em relação ao original.',
    verOriginal: 'Ver o original',
  },
  // Rótulo amigável por valor do enum RESTRICOES (#7). Adjetivos no feminino concordam com
  // o sujeito "Receita" do template. `satisfies Record<Restricao, string>` trava drift do enum
  // (chave faltante/extra/typo) no site de definição.
  restricaoLabel: {
    sem_gluten: 'sem glúten',
    sem_lactose: 'sem lactose',
    vegano: 'vegana',
    vegetariano: 'vegetariana',
    sem_acucar: 'sem açúcar',
    low_carb: 'low carb',
    sem_oleaginosas: 'sem oleaginosas',
    sem_frutos_do_mar: 'sem frutos do mar',
  } satisfies Record<Restricao, string>,
} as const

/**
 * Shape do catálogo, derivado de `ptBR` mas com as folhas alargadas de literal para `string`.
 * Assim o en-US herda exatamente as MESMAS chaves (paridade garantida pelo compilador) sem
 * ficar preso aos literais em português. As folhas em si continuam literais em `typeof ptBR`
 * para quem lê o catálogo pt-BR.
 */
export type Messages = {
  [Section in keyof typeof ptBR]: {
    [Key in keyof (typeof ptBR)[Section]]: string
  }
}
