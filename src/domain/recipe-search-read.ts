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
import { resolveName, type RecipeAuthor, type TranslationRow } from '@/domain/recipe-read'
import { DEFAULT_LOCALE, isSupportedLocale } from '@/i18n/locale'

// Re-export para os consumidores da Busca/Feed (#129) — a Autoria nasce em `recipe-read`
// (módulo mais fundamental; evita ciclo de import) e é compartilhada com o detalhe.
export type { RecipeAuthor }

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
  /**
   * #116/own-label: dono da Receita (BINDADO server-side). LEAK-SAFETY (#116): este campo é
   * INTERNO ao server↔domínio — `projectResult` o consome SÓ para derivar o booleano `isOwn`
   * (`owner_id === viewerId`) e NUNCA o copia para o `SearchResult` (DTO do cliente). Catálogo/
   * sistema tem `owner_id` NULL (nunca igual a um `viewerId` ⇒ nunca "minha").
   */
  owner_id: string | null
  /**
   * Autoria (#129, CONTEXT.md: _Owner / Autoria_) — `name` + `handle` do dono, projetados via
   * LEFT JOIN em `users` sobre `owner_id` (no loader). NULL para Catálogo/sistema (`owner_id`
   * NULL) — sem autor humano ⇒ sem byline. DISTINTO do `owner_id` cru (que NUNCA vaza): o
   * `handle` é o endereço PÚBLICO do perfil (`/u/<handle>`) e o `name` é o rótulo de exibição,
   * AMBOS já públicos. `projectResult` os projeta em `SearchResult.author` (o crédito "por <nome>").
   */
  owner_name: string | null
  owner_handle: string | null
  /**
   * Imagem da receita (#130, ADR-0016) — `blob_url` PÚBLICO da thumbnail (LEFT JOIN em
   * `recipe_image` via `recipe.image_id` no loader). NULL quando a Receita não tem imagem. PÚBLICO
   * — `projectResult` o projeta em `SearchResult.imageUrl`; nunca expõe o `image_id` interno.
   */
  image_url: string | null
  /**
   * Proveniência da imagem (#132) — `recipe_image.provenance` da thumbnail (NULL sem imagem).
   * `projectResult` deriva o booleano `imageAiGenerated` (selo "✨ gerada por IA"). NUNCA expõe o id.
   */
  image_provenance: string | null
}

/** Uma linha do DTO da Busca. `ts_rank`/`owner_id` são INTERNOS — NUNCA aparecem aqui. */
export type SearchResult = {
  recipeId: string
  displayedTitle: string
  origin: Origin
  autoTranslationSignal: boolean
  /**
   * #116/own-label: a Receita é do VIEWER (`owner_id === viewerId`, derivado server-side). Único
   * sinal de dono exposto ao cliente — NUNCA o `owner_id` de ninguém. Dirige o selo "Sua receita"
   * (feed) e a seção "Minhas" (busca). Anônimo ⇒ sempre `false` (nenhum `owner_id` casa undefined).
   */
  isOwn: boolean
  /**
   * Autoria (#129) — `{ name, handle }` PÚBLICOS do dono, para o crédito "por <name>" linkando
   * `/u/<handle>`. AUSENTE ("ausente ≠ vazio") quando a Receita NÃO tem dono humano (Catálogo/
   * sistema): nada de autor falso — o badge de proveniência já marca a origem. Derivado server-
   * side de `owner_name`/`owner_handle`; o `owner_id` cru NUNCA vaza.
   */
  author?: RecipeAuthor
  /**
   * Imagem da receita (#130) — `blob_url` PÚBLICO da thumbnail do card. AUSENTE ("ausente ≠ vazio")
   * quando a Receita não tem imagem ⇒ o card cai no estado limpo (sem thumbnail). Derivado do
   * `image_url` do loader; nunca carrega o `image_id` interno.
   */
  imageUrl?: string
  /** Imagem gerada por IA (#132)? Dirige o selo "✨ gerada por IA" no card. AUSENTE quando não/foto. */
  imageAiGenerated?: boolean
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
 * DTO da Busca: TRÊS seções nomeadas — Minhas (do viewer) primeiro, depois Catálogo, depois
 * Comunidade. `minhas` carrega as Receitas cujo `owner_id === viewerId` (logado); anônimo ⇒
 * `minhas` sempre `[]`. As demais classificam como sempre (`classifySection(origin)`). `consulta`
 * é ADITIVA e OPCIONAL — presente SÓ quando o Perfil culinário resolveu intenção difusa do `?q=`;
 * a chave é OMITIDA (não emitida) caso contrário (preserva o estado neutro
 * `{minhas:[],catalogo:[],comunidade:[]}` byte-a-byte).
 */
export type SearchResponse = {
  minhas: SearchResult[]
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
 * Projeta UM hit para `SearchResult` (5 campos), aplicando `resolveName` (#3), o
 * `autoTranslationSignal` e o booleano `isOwn`. Devolve `null` quando o hit não tem título
 * exibível (sem tradução em `requested`/`original`) — defesa "nunca tela quebrada". Reusado
 * pelas seções, pelas sugestões (#14) E pelo Feed (#103) para a projeção não derivar entre os
 * caminhos.
 *
 * LEAK-SAFETY (#116/own-label): `isOwn` é derivado AQUI de `owner_id === viewerId` e é o ÚNICO
 * sinal de dono no DTO — o `owner_id` cru NUNCA é copiado. `viewerId` undefined (anônimo) ⇒
 * `isOwn` sempre `false` (`null`/qualquer `owner_id` !== undefined).
 */
export function projectResult(
  hit: SearchHitRow,
  locale: string,
  viewerId?: string,
): SearchResult | null {
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
  // #116/own-label: dono == viewer. `viewerId === undefined` (anônimo) NUNCA casa (own=false).
  const isOwn = viewerId !== undefined && hit.owner_id === viewerId
  // #129/Autoria: o crédito "por <name>" linkando /u/<handle>. Só quando há dono HUMANO
  // (owner_name E owner_handle não-NULL — Catálogo/sistema tem ambos NULL ⇒ sem byline).
  // "ausente ≠ vazio": a chave `author` só existe quando há autor — nada de autor falso.
  const author = projectAuthor(hit.owner_name, hit.owner_handle)
  return {
    recipeId: hit.recipe_id,
    displayedTitle,
    origin: hit.origin,
    autoTranslationSignal,
    isOwn,
    ...(author !== undefined ? { author } : {}),
    // #130/Imagem: thumbnail PÚBLICA do card. "ausente ≠ vazio": só quando há blob (image_url != null).
    ...(hit.image_url != null ? { imageUrl: hit.image_url } : {}),
    // #132/selo: imagem gerada por IA? "ausente ≠ vazio": só quando ai_generated.
    ...(hit.image_provenance === 'ai_generated' ? { imageAiGenerated: true } : {}),
  }
}

/**
 * Projeta a Autoria (#129) a partir do `name`/`handle` do dono carregados pelo loader. Devolve
 * `{ name, handle }` SÓ quando AMBOS estão presentes (Receita com dono humano); Catálogo/sistema
 * (ambos NULL) ⇒ `undefined` (sem byline). Defensivo contra um lado NULL inesperado (dados
 * íntegros sempre têm os dois juntos, mas nunca emite um crédito pela metade). PURO/total.
 */
export function projectAuthor(
  ownerName: string | null,
  ownerHandle: string | null,
): RecipeAuthor | undefined {
  if (ownerName == null || ownerHandle == null) return undefined
  return { name: ownerName, handle: ownerHandle }
}

/**
 * Agrupa os hits nas TRÊS seções nomeadas, projetando cada um para `SearchResult`.
 *
 * - Seção: as PRÓPRIAS do viewer (`result.isOwn`, derivado de `owner_id === viewerId`) vão
 *   para `minhas`; o RESTANTE é RE-DERIVADO de `origin` via `classifySection` (catalogo/
 *   comunidade — NÃO confia na ordem entre seções). A ordem DENTRO de cada seção (o ranking
 *   vindo do SQL `ORDER BY section, rn`) é PRESERVADA — empurra na ordem de iteração, nunca
 *   re-ordena. LEAK-SAFETY (#116): o roteamento "minha" é só LABEL/agrupamento; o gate de
 *   leitura (`viewerReadableSqlFragment`) é intocado — uma privada de outro dono nunca chega
 *   aqui, então nunca vira "minha".
 * - `displayedTitle`: `resolveName` (#3) sobre as traduções `requested`/`original`.
 * - `autoTranslationSignal`: `!isTranslationReliable(displayedProvenance)` — rastreia
 *   a proveniência da linha-BASE (nome-primário), não o parêntese. Edge ambos-NULL
 *   (sem tradução exibível) ⇒ hit OMITIDO (não empurra result de título em branco).
 *
 * `viewerId` (#116/own-label): logado ⇒ as próprias Receitas separadas em `minhas`. Anônimo
 * (undefined) ⇒ `isOwn` sempre false ⇒ `minhas` fica `[]` (busca de antes byte-a-byte, só com
 * a chave `minhas:[]` a mais no shape neutro).
 *
 * `consulta` (#10): facetas RESOLVIDAS pela lente, ADITIVA. Quando passada (≠ undefined),
 * é ECOADA como `response.consulta`; quando ausente, a CHAVE é OMITIDA de vez (não emitida
 * como `undefined`) — robusto contra `toStrictEqual` e contra a comparação `toEqual` do
 * estado neutro (`{minhas:[],catalogo:[],comunidade:[]}`).
 *
 * `sugestoes` (#14, Fork C): vizinhos semânticos (US38), ADITIVA. Mesma omissão de chave
 * que `consulta` quando `sugestoesHits` é undefined/vazio.
 */
export function buildSearchResponse(
  hits: ReadonlyArray<SearchHitRow>,
  requestLocale: string,
  viewerId?: string,
  consulta?: FacetasResolvidasDTO,
  sugestoesHits?: ReadonlyArray<SearchHitRow>,
): SearchResponse {
  // Política "nunca tela quebrada": locale não suportado cai em DEFAULT_LOCALE.
  // Redundante quando o route já canonicaliza via `resolveLocale`, mas mantido para
  // o módulo puro ser correto fora do route (testes, futuros call sites).
  const locale = isSupportedLocale(requestLocale) ? requestLocale : DEFAULT_LOCALE

  const response: SearchResponse = { minhas: [], catalogo: [], comunidade: [] }

  for (const hit of hits) {
    // Defesa "nunca tela quebrada": hit sem título exibível é PULADO (não empurra um
    // result de título em branco). Inalcançável em produção (persist.ts sempre insere a
    // tradução do original na tx).
    const result = projectResult(hit, locale, viewerId)
    if (result === null) continue
    // #116/own-label: a PRÓPRIA do viewer vai para `minhas`; o resto classifica por origin.
    if (result.isOwn) response.minhas.push(result)
    // #169/ADR-0019: uma importada da web (`web_imported`) é cópia PRIVADA do importador — nunca
    // conteúdo público da Comunidade. O gate de leitura só a expõe ao próprio dono (⇒ isOwn=true,
    // já roteada acima); um hit web_imported que chegue aqui SEM ser do viewer é dado inconsistente
    // (inalcançável em prod) — DESCARTADO (defesa em profundidade), nunca empurrado p/ comunidade.
    else if (hit.origin === 'web_imported') continue
    else response[classifySection(hit.origin)].push(result)
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
      const result = projectResult(hit, locale, viewerId)
      if (result !== null) sugestoes.push(result)
    }
    if (sugestoes.length > 0) response.sugestoes = sugestoes
  }

  return response
}
