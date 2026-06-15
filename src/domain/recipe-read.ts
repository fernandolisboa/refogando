/**
 * Leitura localizada da Receita — módulo PURO de resolução (issue #3, §4).
 *
 * Sem DB e sem I/O: recebe linhas já carregadas (Recipe + traduções + itens) e
 * resolve a VISTA que a rota serializa. O original é a fonte primária; a tradução
 * é assistiva. As decisões inegociáveis vivem aqui:
 *
 *  - `resolveName`: o original SEMPRE primário. Só anexa `(tradução)` quando há
 *    tradução do locale pedido, ela é CONFIÁVEL (`isTranslationReliable`) e o
 *    `titulo` DIFERE do original. Em qualquer outro caso → original NU (sem
 *    parênteses, sem vazar texto não revisado).
 *  - `resolveBody`: por campo, valor do locale pedido se presente/não-vazio; senão
 *    cai no texto do `originalLocale`; senão `null`. Nunca string vazia.
 *  - `resolveFacets`: cozinha/categoria/tags sempre; `restricoes` SÓ quando há ≥ 1
 *    (array vazio ⇒ chave AUSENTE — distingue "sem restrição" de "presente").
 *  - `resolveRecipeView`: selo `origin` + `schemaVersion` + invariantes
 *    (porcoes/dificuldade/ingredientes) IDÊNTICOS qualquer que seja o `requestLocale`.
 *
 * Sem campo de `aviso`/alerta de contradição: isso é ADR-0004, dono é a #7, FORA
 * de escopo aqui.
 */

import {
  isTranslationReliable,
  type Origin,
  type ResultKind,
  type TranslationProvenance,
  type Visibility,
} from '@/domain/recipe'

/** Linha de Receita conforme retorna de `db.select().from(recipe)`. */
export type RecipeRow = {
  id: string
  origin: Origin
  visibility: Visibility
  resultKind: ResultKind
  originalLocale: string
  cozinha: string | null
  categoria: string | null
  restricoes: string[]
  porcoes: number | null
  dificuldade: number | null
  schemaVersion: number
}

/** Linha de tradução conforme `db.select().from(recipeTranslation)`. */
export type TranslationRow = {
  locale: string
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  provenance: TranslationProvenance
  stale: boolean
}

/**
 * Item de ingrediente — parte das INVARIANTES (não traduzido na #3). `quantidade`
 * é `numeric(10,3)` e VOLTA COMO STRING do driver: mantém-se string (ex. `'2.500'`),
 * nunca número.
 */
export type IngredientItem = {
  ordem: number
  quantidade: string | null
  unidade: string | null
  rawText: string | null
}

export type ResolveInput = {
  recipe: RecipeRow
  translations: ReadonlyArray<TranslationRow>
  ingredients: ReadonlyArray<IngredientItem>
  tags: ReadonlyArray<string>
  requestLocale: string
}

/** Facetas: `restricoes` é opcional — ausente quando o array vier vazio. */
export type RecipeFacets = {
  cozinha: string | null
  categoria: string | null
  tags: ReadonlyArray<string>
  restricoes?: ReadonlyArray<string>
}

export type RecipeBody = {
  descricao: string | null
  passos: string[] | null
  notas: string | null
}

export type TranslationFlags = {
  locale: string
  provenance: TranslationProvenance
  reliable: boolean
  stale: boolean
}

export type RecipeView = {
  id: string
  name: string
  origin: Origin
  schemaVersion: number
  body: RecipeBody
  facets: RecipeFacets
  porcoes: number | null
  dificuldade: number | null
  ingredients: ReadonlyArray<IngredientItem>
  translations: ReadonlyArray<TranslationFlags>
}

/** Acha a tradução do locale pedido (ou `undefined`). */
function findTranslation(
  translations: ReadonlyArray<TranslationRow>,
  locale: string,
): TranslationRow | undefined {
  return translations.find((t) => t.locale === locale)
}

/** Trata `null`/`undefined`/string vazia como ausente. */
function present(value: string | null | undefined): value is string {
  return value !== null && value !== undefined && value !== ''
}

/**
 * Nome resolvido: original primário. Só `Original (Tradução)` quando a tradução do
 * locale pedido existe, é confiável e DIFERE do original. Caso contrário, original nu.
 */
export function resolveName(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): string {
  const original = findTranslation(input.translations, input.originalLocale)
  // O original é a fonte: seu `titulo` é o nome-base. Se faltar (não deveria),
  // cai no que houver do locale pedido como último recurso.
  const baseName =
    original?.titulo ?? findTranslation(input.translations, input.requestLocale)?.titulo ?? ''

  // Branch 1 (AC#2): mesmo locale ⇒ original nu, sem parênteses.
  if (input.requestLocale === input.originalLocale) return baseName

  const requested = findTranslation(input.translations, input.requestLocale)

  // Branch 2: não há tradução do locale pedido ⇒ original nu.
  if (!requested) return baseName

  // Branch 3 (AC#1 negativo): tradução não-confiável (automatica_nao_revisada) ⇒
  // original nu, NUNCA vaza o texto não revisado.
  if (!isTranslationReliable(requested.provenance)) return baseName

  // `titulo` em-branco-após-trim é tratado como AUSENTE: nada de `(   )` no nome.
  const requestedTitulo = requested.titulo.trim()

  // Branch 4 (AC#2 redundante): tradução confiável mas IGUAL ao original ⇒ sem parênteses.
  if (requestedTitulo === baseName) return baseName

  // Positivo (AC#1): confiável e diferente ⇒ `Original (Tradução)`. Nunca `()` vazio.
  if (!present(requestedTitulo)) return baseName
  return `${baseName} (${requestedTitulo})`
}

/**
 * Corpo resolvido: por campo, valor do locale pedido se presente/não-vazio; senão
 * o do `originalLocale`; senão `null`.
 */
export function resolveBody(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): RecipeBody {
  const source = findTranslation(input.translations, input.originalLocale)
  const requested = findTranslation(input.translations, input.requestLocale)

  // Candidatos em locais: o `present()` estreita o valor diretamente — sem `!`.
  const reqDescricao = requested?.descricao
  const srcDescricao = source?.descricao
  const descricao = present(reqDescricao) ? reqDescricao : present(srcDescricao) ? srcDescricao : null

  const reqPassos = requested?.passos
  const srcPassos = source?.passos
  const passos =
    reqPassos && reqPassos.length > 0
      ? reqPassos
      : srcPassos && srcPassos.length > 0
        ? srcPassos
        : null

  const reqNotas = requested?.notas
  const srcNotas = source?.notas
  const notas = present(reqNotas) ? reqNotas : present(srcNotas) ? srcNotas : null

  return { descricao, passos, notas }
}

/**
 * Facetas: cozinha/categoria/tags sempre; `restricoes` só quando há ≥ 1 (vazio ⇒
 * chave AUSENTE — distingue "sem restrição" de "presente").
 */
export function resolveFacets(input: {
  cozinha: string | null
  categoria: string | null
  tags: ReadonlyArray<string>
  restricoes: ReadonlyArray<string>
}): RecipeFacets {
  const facets: RecipeFacets = {
    cozinha: input.cozinha,
    categoria: input.categoria,
    tags: input.tags,
  }
  if (input.restricoes.length > 0) facets.restricoes = input.restricoes
  return facets
}

/**
 * Vista completa: nome + corpo + selo `origin` SEMPRE + facetas + invariantes
 * (porcoes/dificuldade/ingredientes) + `schemaVersion` + flags de tradução (display).
 * As invariantes e o selo são IDÊNTICOS qualquer que seja o `requestLocale`.
 */
export function resolveRecipeView(input: ResolveInput): RecipeView {
  const name = resolveName({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })
  const body = resolveBody({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
  })
  const facets = resolveFacets({
    cozinha: input.recipe.cozinha,
    categoria: input.recipe.categoria,
    tags: input.tags,
    restricoes: input.recipe.restricoes,
  })

  return {
    id: input.recipe.id,
    name,
    origin: input.recipe.origin,
    schemaVersion: input.recipe.schemaVersion,
    body,
    facets,
    porcoes: input.recipe.porcoes,
    dificuldade: input.recipe.dificuldade,
    ingredients: input.ingredients,
    translations: input.translations.map((t) => ({
      locale: t.locale,
      provenance: t.provenance,
      reliable: isTranslationReliable(t.provenance),
      stale: t.stale,
    })),
  }
}
