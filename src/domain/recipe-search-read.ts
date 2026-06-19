/**
 * Montagem PURA do DTO da Busca (#6, §3.6). Sem DB, sem I/O: recebe as linhas de
 * resultado já carregadas (`SearchHitRow[]`) + o `requestLocale` e devolve a
 * `SearchResponse` que o route serializa. Espelha a separação route↔`resolveRecipeView`
 * da #3 — o route não faz lógica de display.
 *
 * Reusa `resolveName` (#3) para o `displayedTitle` (original primário + tradução
 * confiável) e `isTranslationReliable` (#3) para o `autoTranslationSignal`. NÃO
 * re-deriva o conjunto confiável nem a seleção de base de `resolveName`.
 *
 * Direção de dependência: este módulo de DOMÍNIO define o contrato de linha
 * (`SearchHitRow`) e os tipos do DTO; o loader em `@/server/recipe/search` IMPORTA
 * daqui e os preenche — espelha como `recipe-read.ts` define `RecipeRow`/`TranslationRow`
 * e `load.ts` os consome. O domínio NUNCA importa de `server/`.
 */

import {
  classifySection,
  isTranslationReliable,
  type Origin,
  type SearchSection,
  type TranslationProvenance,
} from '@/domain/recipe'
import { resolveName, type TranslationRow } from '@/domain/recipe-read'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'

/**
 * Linha de resultado da Busca, projetada pelo loader (`@/server/recipe/search`).
 * OWNED por este módulo de domínio; o loader IMPORTA daqui (NÃO redefine).
 *
 * Carrega a tradução do locale PEDIDO (`requested_*`, se existir) e a do ORIGINAL
 * (`original_*`) — as duas que `resolveName` consulta para projetar o nome e que
 * `displayedProvenance` usa para o sinal. `section` é computado no SQL para particionar
 * o `ROW_NUMBER`; `buildSearchResponse` o RE-DERIVA via `classifySection(origin)`.
 */
export type SearchHitRow = {
  recipe_id: string
  origin: Origin
  original_locale: string
  requested_titulo: string | null
  requested_provenance: TranslationProvenance | null
  original_titulo: string | null
  original_provenance: TranslationProvenance | null
  section: SearchSection // SQL-internal (partition/cap); never read in TS — classifySection(origin) is the grouping truth
}

/** Uma linha do DTO da Busca. `ts_rank` é INTERNO — NUNCA aparece aqui. */
export type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: Origin
  autoTranslationSignal: boolean
}

/**
 * Facetas RESOLVIDAS pelo Perfil culinário a partir do `?q=` difuso (#10, AC3/AC4).
 * Termos do CONTEXT.md: "Consulta"/"facetas resolvidas" — NUNCA "filtros aplicados"/
 * "tags(genérico)"/"query". É EDITÁVEL pelo cliente (default, não filtro travado): a UI
 * a apresenta como Consulta e re-GETa com `?cozinha=...` explícito ao editá-la. Só as
 * chaves que a lente resolveu aparecem.
 */
export type FacetasResolvidasDTO = {
  cozinhas?: string[]
  categorias?: string[]
  tags?: string[]
  restricoes?: string[]
  dificuldade?: { min?: number; max?: number }
  porcoes?: { min?: number; max?: number }
}

/**
 * DTO da Busca: duas seções nomeadas, Catálogo primeiro. `consulta` é ADITIVA e
 * OPCIONAL — presente SÓ quando o Perfil culinário resolveu intenção difusa do `?q=`;
 * a chave é OMITIDA (não emitida) caso contrário (preserva o estado neutro
 * `{catalogo:[],comunidade:[]}` byte-a-byte).
 */
export type SearchResponse = {
  catalogo: SearchResult[]
  comunidade: SearchResult[]
  consulta?: FacetasResolvidasDTO
  /** "Talvez você queira" (#14, US38): vizinhos semânticos quando a busca por nome NÃO
   * casa exato. ADITIVA e OPCIONAL — presente SÓ quando há expansão semântica sem precisa;
   * a chave é OMITIDA senão (preserva o estado neutro byte-a-byte). Mesmos 4 campos de
   * SearchResult — NUNCA score/cosseno/matchKind. */
  sugestoes?: SearchResult[]
}

/** Campos que `resolveName` nunca lê de uma `TranslationRow` ao resolver o NOME —
 * preenchidos com valores NEUTROS para satisfazer o tipo COMPLETO sem afetar o
 * comportamento (em runtime só `locale`/`titulo`/`provenance` importam). */
const NEUTRAL_FILL = { descricao: null, passos: null, notas: null, stale: false } as const

/**
 * Monta as `TranslationRow` COMPLETAS que `resolveName` espera, a partir das
 * traduções `requested`/`original` de uma linha. Preenche os campos não lidos com
 * `NEUTRAL_FILL`. Inclui só as traduções presentes (titulo não-nulo).
 */
function hitTranslations(hit: SearchHitRow, requestLocale: string): TranslationRow[] {
  const rows: TranslationRow[] = []
  if (hit.requested_titulo != null && hit.requested_provenance != null) {
    rows.push({
      locale: requestLocale,
      titulo: hit.requested_titulo,
      provenance: hit.requested_provenance,
      ...NEUTRAL_FILL,
    })
  }
  if (hit.original_titulo != null && hit.original_provenance != null) {
    rows.push({
      locale: hit.original_locale,
      titulo: hit.original_titulo,
      provenance: hit.original_provenance,
      ...NEUTRAL_FILL,
    })
  }
  return rows
}

/**
 * Proveniência da linha-BASE de `resolveName` — a linha cujo `titulo` vira o
 * nome-PRIMÁRIO visível (NÃO o parêntese assistivo). PURA.
 *
 * Espelha a seleção de base de `resolveName` (`recipe-read.ts:174-175`):
 * `original?.titulo ?? findTranslation(requestLocale)?.titulo`. Ou seja, a base é a
 * linha do `original_locale` quando ela existe (→ `original_provenance`); na sua
 * ausência, a linha de fallback do `requestLocale` (→ `requested_provenance`).
 *
 * Edge ambos-NULL (não deveria ocorrer — toda Receita tem ≥1 tradução e só casa no
 * FTS com tradução): devolve `null`, tratado como NÃO-confiável por `buildSearchResponse`.
 *
 * Chavear em `original_provenance != null` equivale a `resolveName` chavear em
 * `original_titulo != null`: ambos projetam do MESMO alias do LEFT JOIN e, no schema,
 * `recipe_translation.titulo`+`provenance` são NOT NULL (schema.ts) — então um futuro
 * `titulo` anulável precisa revisitar isto.
 */
export function displayedProvenance(hit: SearchHitRow): TranslationProvenance | null {
  if (hit.original_provenance != null) return hit.original_provenance
  return hit.requested_provenance
}

/**
 * Projeta UM hit para `SearchResult` (4 campos), aplicando `resolveName` (#3) e o
 * `autoTranslationSignal`. Devolve `null` quando o hit não tem título exibível (sem
 * tradução em `requested`/`original`) — defesa "nunca tela quebrada". Reusado pelas
 * seções E pelas sugestões (#14) para a projeção não derivar entre os dois caminhos.
 */
export function projectResult(hit: SearchHitRow, locale: string): SearchResult | null {
  const translations = hitTranslations(hit, locale)
  if (translations.length === 0) return null
  const displayedTitle = resolveName({
    originalLocale: hit.original_locale,
    requestLocale: locale,
    translations,
  })
  const baseProvenance = displayedProvenance(hit)
  const autoTranslationSignal =
    baseProvenance == null ? true : !isTranslationReliable(baseProvenance)
  return {
    recipeId: hit.recipe_id,
    displayedTitle,
    origin: hit.origin,
    autoTranslationSignal,
  }
}

/**
 * Agrupa os hits nas seções nomeadas, projetando cada um para `SearchResult`.
 *
 * - Seção: RE-DERIVADA de `origin` via `classifySection` (NÃO confia na ordem entre
 *   seções), mas a ordem DENTRO de cada seção (o ranking vindo do SQL `ORDER BY
 *   section, rn`) é PRESERVADA — empurra na ordem de iteração, nunca re-ordena.
 * - `displayedTitle`: `resolveName` (#3) sobre as traduções `requested`/`original`.
 * - `autoTranslationSignal`: `!isTranslationReliable(displayedProvenance)` — rastreia
 *   a proveniência da linha-BASE (nome-primário), não o parêntese. Edge ambos-NULL
 *   (sem tradução exibível) ⇒ hit OMITIDO (não empurra result de título em branco).
 *
 * `consulta` (#10): facetas RESOLVIDAS pela lente, ADITIVA. Quando passada (≠ undefined),
 * é ECOADA como `response.consulta`; quando ausente, a CHAVE é OMITIDA de vez (não emitida
 * como `undefined`) — robusto contra `toStrictEqual` e contra a comparação `toEqual` do
 * estado neutro de #6/#9 (`{catalogo:[],comunidade:[]}`).
 *
 * `sugestoes` (#14, Fork C): vizinhos semânticos (US38), ADITIVA. Mesma omissão de chave
 * que `consulta` quando `sugestoesHits` é undefined/vazio.
 */
export function buildSearchResponse(
  hits: ReadonlyArray<SearchHitRow>,
  requestLocale: string,
  consulta?: FacetasResolvidasDTO,
  sugestoesHits?: ReadonlyArray<SearchHitRow>,
): SearchResponse {
  // Política "nunca tela quebrada": locale não suportado cai em DEFAULT_LOCALE.
  // Redundante quando o route já canonicaliza via `resolveLocale`, mas mantido para
  // o módulo puro ser correto fora do route (testes, futuros call sites).
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const response: SearchResponse = { catalogo: [], comunidade: [] }

  for (const hit of hits) {
    // Defesa "nunca tela quebrada": hit sem título exibível é PULADO (não empurra um
    // result de título em branco). Inalcançável em produção (persist.ts sempre insere a
    // tradução do original na tx).
    const result = projectResult(hit, locale)
    if (result === null) continue
    response[classifySection(hit.origin)].push(result)
  }

  // Aditivo (#10): só adiciona a CHAVE quando a lente resolveu intenção difusa.
  if (consulta !== undefined) {
    response.consulta = consulta
  }

  // Aditivo (#14, Fork C): só adiciona a CHAVE `sugestoes` quando há vizinhos semânticos
  // exibíveis. Quando `sugestoesHits` é undefined/vazio (caso comum: há precisa, ou
  // degradação), a chave é OMITIDA → preserva o `toEqual` do estado neutro e o
  // reduce-to-#6/#9/#10 byte-a-byte. Mesmos 4 campos — NUNCA cosseno/score.
  if (sugestoesHits !== undefined && sugestoesHits.length > 0) {
    const sugestoes: SearchResult[] = []
    for (const hit of sugestoesHits) {
      const result = projectResult(hit, locale)
      if (result !== null) sugestoes.push(result)
    }
    if (sugestoes.length > 0) response.sugestoes = sugestoes
  }

  return response
}
