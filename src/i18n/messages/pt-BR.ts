/**
 * Catálogo de chrome em pt-BR (issue #4). `Messages = typeof ptBR` ancora o shape;
 * o en-US DEVE ter exatamente as mesmas chaves (teste de paridade T3 garante).
 */
export const ptBR = {
  app: { name: 'Refogando', tagline: 'Receitas com IA, em pt-BR e en-US' },
  nav: { home: 'Início', recipes: 'Receitas', signIn: 'Entrar', signOut: 'Sair' },
  locale: { label: 'Idioma', ptBR: 'Português (Brasil)', enUS: 'Inglês (EUA)' },
  system: { loading: 'Carregando…', error: 'Algo deu errado.', notFound: 'Não encontrado.' },
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
