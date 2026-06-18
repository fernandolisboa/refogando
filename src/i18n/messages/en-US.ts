/**
 * Catálogo de chrome em en-US (issue #4). Tipado como `Messages` (= typeof ptBR):
 * o compilador exige as MESMAS chaves do pt-BR; o teste de paridade T3 confirma em runtime.
 */
import type { Categoria, Cozinha, Restricao, Unidade } from '@/domain/vocabulary'
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
  // Tela de Busca (#56), mesma substância traduzida (ADR-0001, não byte-idêntica).
  busca: {
    titulo: 'Search recipes',
    placeholder: 'Type a dish, ingredient, or culinary style',
    buscar: 'Search',
    dicaInicial: 'Start typing a dish, ingredient, or style you like — or use the filters.',
    semResultado: 'No recipes found. Try another term or adjust the filters.',
    secaoCatalogo: 'Catalog',
    secaoComunidade: 'Community',
    seloCatalogo: 'From the catalog',
    seloComunidade: 'From the community',
    traducaoAutomatica: 'automatic translation',
    talvezQueira: 'Maybe you want',
    consultaLabel: 'You are searching for:',
    filtroCozinha: 'Cuisine',
    filtroCategoria: 'Category',
    filtroRestricao: 'Dietary restriction',
  },
  // Rótulo amigável por valor do enum COZINHAS (#56), traduzido por locale.
  cozinhaLabel: {
    italiana: 'Italian',
    japonesa: 'Japanese',
    brasileira: 'Brazilian',
    baiana: 'Bahian',
    mineira: 'Minas Gerais',
    mexicana: 'Mexican',
    chinesa: 'Chinese',
    indiana: 'Indian',
    tailandesa: 'Thai',
    francesa: 'French',
    arabe: 'Arabic',
    portuguesa: 'Portuguese',
    mediterranea: 'Mediterranean',
    peruana: 'Peruvian',
  } satisfies Record<Cozinha, string>,
  // Rótulo amigável por valor do enum CATEGORIAS (#56), traduzido por locale.
  categoriaLabel: {
    entrada: 'Starter',
    prato_principal: 'Main course',
    sobremesa: 'Dessert',
    bebida: 'Drink',
    molho: 'Sauce',
    acompanhamento: 'Side',
    lanche: 'Snack',
    cafe_da_manha: 'Breakfast',
  } satisfies Record<Categoria, string>,
  // Rótulo amigável por valor do enum UNIDADES (#57), traduzido por locale.
  unidadeLabel: {
    g: 'g',
    kg: 'kg',
    ml: 'ml',
    l: 'l',
    colher_de_sopa: 'tablespoon',
    colher_de_cha: 'teaspoon',
    xicara: 'cup',
    unidade: 'unit',
    dente: 'clove',
    fatia: 'slice',
    pitada: 'pinch',
    a_gosto: 'to taste',
    q_b: 'as needed',
  } satisfies Record<Unidade, string>,
  // Página de detalhe da Receita (#57), mesma substância traduzida (ADR-0001, não
  // byte-idêntica). Selos de proveniência REUSAM busca.seloCatalogo/seloComunidade.
  detalhe: {
    ingredientes: 'Ingredients',
    passos: 'Steps',
    notas: 'Notes',
    descricao: 'Description',
    porcoes: 'Servings',
    dificuldade: 'Difficulty',
    cozinha: 'Cuisine',
    categoria: 'Category',
    restricoes: 'Restrictions',
    tags: 'Tags',
    avisoTitulo: 'Restriction notice',
  },
  // Telas de autenticação (#55), mesma substância traduzida (ADR-0001, não byte-idêntica).
  // Reusa nav.signIn/signOut onde idêntico ao header; aqui só o contextual das telas.
  auth: {
    criarConta: 'Create account',
    nome: 'Name',
    email: 'Email',
    senha: 'Password',
    senhaDica: 'At least 8 characters',
    enviando: 'Submitting…',
    continuarComGoogle: 'Continue with Google',
    ou: 'or',
    jaTemConta: 'Already have an account?',
    semConta: 'New here?',
    erroCredencialInvalida: 'Wrong email or password.',
    erroEmailEmUso: 'This email is already registered.',
    erroSenhaCurta: 'Password must be at least 8 characters.',
    erroRede: 'Could not connect. Please try again.',
    erroGenerico: 'Could not complete. Please try again.',
  },
} as const
