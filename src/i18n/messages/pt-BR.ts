/**
 * Catálogo de chrome em pt-BR (issue #4). `Messages = typeof ptBR` ancora o shape;
 * o en-US DEVE ter exatamente as mesmas chaves (teste de paridade T3 garante).
 */
import type { Categoria, Cozinha, Restricao, Unidade } from '@/domain/vocabulary'

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
  // Tela de Busca (#56): título, campo, estados (inicial/vazio), seções e selos de
  // proveniência por item. Os rótulos de SELO ("Do catálogo"/"Da comunidade") são
  // distintos dos de SEÇÃO ("Catálogo"/"Comunidade") de propósito — desambigua heading
  // de etiqueta de item e lê melhor.
  busca: {
    titulo: 'Buscar receitas',
    placeholder: 'Digite um prato, ingrediente ou estilo culinário',
    buscar: 'Buscar',
    dicaInicial: 'Comece digitando um prato, ingrediente ou estilo que você curte — ou use os filtros.',
    semResultado: 'Nenhuma receita encontrada. Tente outro termo ou ajuste os filtros.',
    secaoCatalogo: 'Catálogo',
    secaoComunidade: 'Comunidade',
    seloCatalogo: 'Do catálogo',
    seloComunidade: 'Da comunidade',
    traducaoAutomatica: 'tradução automática',
    talvezQueira: 'Talvez você queira',
    consultaLabel: 'Você está buscando:',
    filtroCozinha: 'Cozinha',
    filtroCategoria: 'Categoria',
    filtroRestricao: 'Restrição',
  },
  // Rótulo amigável por valor do enum COZINHAS (#56). `satisfies Record<Cozinha, string>`
  // trava drift do enum (chave faltante/extra/typo) no site de definição.
  cozinhaLabel: {
    italiana: 'Italiana',
    japonesa: 'Japonesa',
    brasileira: 'Brasileira',
    baiana: 'Baiana',
    mineira: 'Mineira',
    mexicana: 'Mexicana',
    chinesa: 'Chinesa',
    indiana: 'Indiana',
    tailandesa: 'Tailandesa',
    francesa: 'Francesa',
    arabe: 'Árabe',
    portuguesa: 'Portuguesa',
    mediterranea: 'Mediterrânea',
    peruana: 'Peruana',
  } satisfies Record<Cozinha, string>,
  // Rótulo amigável por valor do enum CATEGORIAS (#56).
  categoriaLabel: {
    entrada: 'Entrada',
    prato_principal: 'Prato principal',
    sobremesa: 'Sobremesa',
    bebida: 'Bebida',
    molho: 'Molho',
    acompanhamento: 'Acompanhamento',
    lanche: 'Lanche',
    cafe_da_manha: 'Café da manhã',
  } satisfies Record<Categoria, string>,
  // Rótulo amigável por valor do enum UNIDADES (#57). Os valores do enum são tokens
  // machine-readable (snake_case); este mapa os converte em texto legível na linha do
  // ingrediente. `satisfies Record<Unidade, string>` trava drift do enum.
  unidadeLabel: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'colher de sopa',
    colher_de_cha: 'colher de chá',
    xicara: 'xícara',
    unidade: 'unidade',
    dente: 'dente',
    fatia: 'fatia',
    pitada: 'pitada',
    a_gosto: 'a gosto',
    q_b: 'q.b.',
  } satisfies Record<Unidade, string>,
  // Página de detalhe da Receita (#57): headings/rótulos da leitura localizada. Os SELOS
  // de proveniência REUSAM busca.seloCatalogo/seloComunidade (mesmo conceito/componente
  // ProvenanceBadge da #56) — não duplicar aqui.
  detalhe: {
    ingredientes: 'Ingredientes',
    passos: 'Modo de preparo',
    notas: 'Notas',
    descricao: 'Descrição',
    porcoes: 'Porções',
    dificuldade: 'Dificuldade',
    cozinha: 'Cozinha',
    categoria: 'Categoria',
    restricoes: 'Restrições',
    tags: 'Tags',
    avisoTitulo: 'Aviso de restrição',
  },
  // Telas de autenticação (#55): entrar / criar conta. Objeto PLANO (folhas string) —
  // o TIPO `Messages` exige um nível de namespace. Guarda só o CONTEXTUAL das telas; o
  // que é idêntico ao header REUSA `nav.signIn`/`nav.signOut` (não duplicar — ADR-0001).
  // Erros traduzidos por CHAVE (mapErrorToKey casa `error.code` do Better Auth, nunca o
  // status); NUNCA exibir a mensagem crua do servidor.
  auth: {
    criarConta: 'Criar conta',
    nome: 'Nome',
    email: 'Email',
    senha: 'Senha',
    senhaDica: 'Mínimo de 8 caracteres',
    enviando: 'Enviando…',
    continuarComGoogle: 'Continuar com o Google',
    ou: 'ou',
    jaTemConta: 'Já tem uma conta?',
    semConta: 'Ainda não tem conta?',
    erroCredencialInvalida: 'Email ou senha incorretos.',
    erroEmailEmUso: 'Este email já está cadastrado.',
    erroSenhaCurta: 'A senha precisa ter pelo menos 8 caracteres.',
    erroRede: 'Não foi possível conectar. Tente de novo.',
    erroGenerico: 'Não foi possível concluir. Tente de novo.',
  },
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
