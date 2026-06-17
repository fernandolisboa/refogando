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
 *  - `avisos` (#7, ADR-0004): a vista anexa `avisos?` SÓ quando há ≥ 1 contradição
 *    óbvia entre o dado oportunista de alérgeno e uma restrição declarada (mesma regra
 *    "ausente ≠ vazio" das facetas/`restricoes`). O motor PURO `decideRestrictionNotices`
 *    decide os CÓDIGOS (locale-neutros); a vista mapeia cada código → `AvisoView`,
 *    repassando os códigos 1:1 e adicionando a frase `mensagem` já renderizada no
 *    `requestLocale`. NUNCA bloqueia/suprime/gateia nada (Aviso é leitura, não verificação).
 */

import {
  isTranslationReliable,
  type Origin,
  type ResultKind,
  type TranslationProvenance,
  type Visibility,
} from '@/domain/recipe'
import {
  decideRestrictionNotices,
  type RestrictionNotice,
} from '@/domain/recipe-restrictions'
import { isRestricao, type Restricao } from '@/domain/vocabulary'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'
import { MESSAGES } from '@/i18n/messages'

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
 * Item de ingrediente conforme o LOADER projeta (entrada de `resolveRecipeView`) —
 * parte das INVARIANTES (não traduzido na #3). `quantidade` é `numeric(10,3)` e VOLTA
 * COMO STRING do driver: mantém-se string (ex. `'2.500'`), nunca número.
 *
 * `alergenos` (#7) é REQUERIDO: o loader SEMPRE o projeta via LEFT JOIN na tabela PAI
 * `ingredient` (`null` quando a FK é nula/sem dado, ou um `string[]`). É dado de
 * decisão do motor de Aviso — NUNCA sai na vista (ver `IngredientView`, que o omite).
 */
export type IngredientItem = {
  ordem: number
  quantidade: string | null
  unidade: string | null
  rawText: string | null
  alergenos: string[] | null
}

/**
 * Item de ingrediente como sai na VISTA serializada: `IngredientItem` SEM `alergenos`.
 * O dado de alérgeno é insumo do motor de Aviso (decisão), não conteúdo da vista —
 * o `Omit` garante em compile-time que ele NUNCA vaza em `view.ingredients`.
 */
export type IngredientView = Omit<IngredientItem, 'alergenos'>

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

/**
 * Aviso de contradição como sai na VISTA (#7): os CÓDIGOS do domínio
 * (`kind`/`restricao`/`alergeno`, repassados 1:1 do `RestrictionNotice`) MAIS a frase
 * `mensagem` já renderizada no `requestLocale`. DISTINTO do `RestrictionNotice` (que é
 * só códigos, locale-neutro): a vista é quem adiciona o texto localizado. Expor os
 * códigos permite a UI estilizar/agrupar sem re-parsear a `mensagem`.
 */
export type AvisoView = {
  kind: 'contradicao'
  restricao: Restricao
  alergeno: string
  mensagem: string
}

/**
 * Aviso de tradução obsoleta como sai na VISTA (#23, AC3): a tradução do `requestLocale`
 * está marcada `stale` (o original mudou depois da tradução). Traz a `mensagem` leve já
 * renderizada no requestLocale + o rótulo "ver o original" + os locales. A UI lincа o
 * "ver o original" pro GET com `?locale=originalLocale` (NÃO embutimos o corpo original).
 * AUSENTE quando se vê a origem (`requestLocale === originalLocale`) — a origem nunca é
 * sinalizada (alinha com `resolveName` Branch 1).
 */
export type StaleNotice = {
  locale: string
  originalLocale: string
  mensagem: string
  verOriginalLabel: string
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
  ingredients: ReadonlyArray<IngredientView>
  translations: ReadonlyArray<TranslationFlags>
  /** Avisos de contradição — AUSENTE quando vazio (ausente ≠ "verificado OK"). */
  avisos?: AvisoView[]
  /** Aviso de tradução obsoleta — AUSENTE salvo quando a tradução pedida é stale e ≠ origem. */
  staleNotice?: StaleNotice
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
 * Renderiza cada `RestrictionNotice` (códigos, locale-neutro) → `AvisoView` (códigos +
 * frase localizada). PURO: o catálogo `MESSAGES` é constante importada (não I/O).
 *
 * O `requestLocale` é estreitado por `isSupportedLocale`; locale desconhecido cai em
 * `DEFAULT_LOCALE` — mesma política "nunca tela quebrada" de `resolveLocale`. A restrição
 * vira RÓTULO amigável localizado (`restricaoLabel`, cobre todo o enum — sem chave
 * faltante); o token de alérgeno é interpolado CRU (free-text, sem vocabulário de
 * rótulos — limitação menor conhecida, §D3). Interpolação por `String.replace`, sem ICU.
 */
export function renderAvisos(
  notices: ReadonlyArray<RestrictionNotice>,
  requestLocale: string,
): AvisoView[] {
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE
  const msgs = MESSAGES[locale]
  return notices.map((n) => {
    const label = msgs.restricaoLabel[n.restricao]
    // Replacers como FUNÇÃO (não string): o 2º arg-string de String.replace interpreta
    // `$&`, `$\``, `$'`, `$$`, `$n` como diretivas; a função devolve o valor literal, sem
    // substituição — protege contra um `$` no token de alérgeno/rótulo corromper a frase.
    const mensagem = msgs.aviso.contradicao
      .replace('{restricao}', () => label)
      .replace('{alergeno}', () => n.alergeno)
    return { kind: n.kind, restricao: n.restricao, alergeno: n.alergeno, mensagem }
  })
}

/**
 * Aviso de tradução obsoleta (#23, AC3): PURO, renderiza a frase + o rótulo no
 * requestLocale. Devolve `undefined` SALVO quando a tradução de `requestLocale` existe,
 * está `stale` E `requestLocale !== originalLocale` (a origem NUNCA é sinalizada — alinha
 * com `resolveName` Branch 1). `loc` cai em `DEFAULT_LOCALE` se o requestLocale não for
 * suportado (mesma guarda de `renderAvisos`, "nunca tela quebrada").
 */
export function renderStaleNotice(input: {
  originalLocale: string
  requestLocale: string
  translations: ReadonlyArray<TranslationRow>
}): StaleNotice | undefined {
  if (input.requestLocale === input.originalLocale) return undefined
  const requested = findTranslation(input.translations, input.requestLocale)
  if (!requested || !requested.stale) return undefined
  const loc = isSupportedLocale(input.requestLocale) ? input.requestLocale : DEFAULT_LOCALE
  const msgs = MESSAGES[loc]
  return {
    locale: input.requestLocale,
    originalLocale: input.originalLocale,
    mensagem: msgs.traducao.staleAviso,
    verOriginalLabel: msgs.traducao.verOriginal,
  }
}

/**
 * Vista completa: nome + corpo + selo `origin` SEMPRE + facetas + invariantes
 * (porcoes/dificuldade/ingredientes) + `schemaVersion` + flags de tradução (display) +
 * `avisos?` (anexado SÓ quando há contradição). As invariantes e o selo são IDÊNTICOS
 * qualquer que seja o `requestLocale`; só `name`/`body`/`avisos.mensagem` variam por locale.
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

  // Aviso de restrição (#7): o motor PURO decide os CÓDIGOS; a vista os renderiza no
  // requestLocale. `restricoes` vem como `string[]` do loader — filtra por `isRestricao`
  // (defensivo, sem `as`) antes de passar ao motor, que só conhece valores do enum.
  const decision = decideRestrictionNotices({
    restricoes: input.recipe.restricoes.filter(isRestricao),
    items: input.ingredients.map((i) => ({ alergenos: i.alergenos })),
  })
  const avisos = renderAvisos(decision.avisos, input.requestLocale)

  // Aviso de tradução obsoleta (#23, AC3): só quando a tradução pedida é stale e ≠ origem.
  const staleNotice = renderStaleNotice({
    originalLocale: input.recipe.originalLocale,
    requestLocale: input.requestLocale,
    translations: input.translations,
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
    // Projeta SEM `alergenos`: insumo de decisão, não conteúdo da vista (Omit guard).
    ingredients: input.ingredients.map(({ ordem, quantidade, unidade, rawText }) => ({
      ordem,
      quantidade,
      unidade,
      rawText,
    })),
    translations: input.translations.map((t) => ({
      locale: t.locale,
      provenance: t.provenance,
      reliable: isTranslationReliable(t.provenance),
      stale: t.stale,
    })),
    // Ausente ≠ vazio: anexa `avisos` SÓ quando há ≥ 1 (espelha `resolveFacets.restricoes`).
    ...(avisos.length > 0 ? { avisos } : {}),
    // Ausente quando a tradução pedida não é stale (ou é a origem) — espelha `avisos?`.
    ...(staleNotice ? { staleNotice } : {}),
  }
}
