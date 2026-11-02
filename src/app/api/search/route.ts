import { getDb, getEmbedder } from '@/server/deps'
import { requireSession } from '@/server/auth/guard'
import { resolveLocale } from '@/i18n/locale'
import { searchRecipes, MAX_QUERY_LEN } from '@/server/recipe/search'
import { resolveSearchQueryVector } from '@/server/search/query-embedding'
import { clientIpFromHeaders } from '@/server/http/params'
import {
  buildSearchResponse,
  type FacetasResolvidasDTO,
} from '@/domain/recipe-search-read'
import { parseSearchTerms, parseMatchMode, stripControlChars } from '@/domain/search-terms'
import { parseSort } from '@/domain/sort-params'
import {
  parseFacetParams,
  isFacetsEmpty,
  type EffectiveFacets,
} from '@/domain/facet-params'
import type { Restricao } from '@/domain/vocabulary'
import {
  resolveCulinaryProfile,
  type FacetasResolvidas,
} from '@/domain/culinary-profile'
import { loadVocabulary } from '@/server/vocabulary/load'
import { eq } from 'drizzle-orm'
import { users } from '@/db/schema'
import {
  PARAM_RESTRICAO_PERFIL,
  normalizarRestricoes,
  somarRestricoes,
} from '@/domain/restricoes-perfil'

/**
 * Busca precisa (issue #6): FTS Postgres + unaccent, seccionada por origem.
 * Route fino — espelha o template de `recipes/[id]/route.ts` (runtime nodejs,
 * getDb(), Response.json) e delega o display ao módulo PURO `buildSearchResponse`.
 *
 * GET `?q=` + `?locale=`. AUTH OPCIONAL (#116): resolve a sessão SEM 401 — Visitante
 * (ADR-0011) busca só o pool da comunidade; LOGADO recebe `viewerId` e a Busca inclui também
 * as PRÓPRIAS Receitas (privadas inclusive). `requireSession` falhando (anônimo/conta
 * desativada) ⇒ `viewerId` undefined ⇒ comportamento de antes (NUNCA propaga o 401 daqui).
 *
 * Diferença deliberada vs. `recipes/[id]/route.ts`: em vez de `parseRequestLocale`
 * (que devolve o `?locale` CRU), a Busca CANONICALIZA o locale na borda via
 * `resolveLocale` ('pt-br'→'pt-BR'; ausente/não suportado → DEFAULT_LOCALE),
 * porque o loader o usa como predicado SQL case-sensitive contra
 * `recipe_translation.locale`. O MESMO valor canônico alimenta loader E display.
 */

export const runtime = 'nodejs' // postgres-js exige Node, não Edge.

/**
 * Converte as facetas RESOLVIDAS pela lente em `EffectiveFacets` validada. O mapa é
 * código confiável (literais de enum corretos por construção), mas re-passamos pelo MESMO
 * parse de borda (`parseFacetParams`) para a borda ficar uniforme e as faixas/tags virem
 * na forma que o loader consome. Tags já vêm folded da lente; `parseFacetParams` re-aplica
 * `foldIntent` (idempotente sobre valor já folded).
 */
function facetasFromResolution(
  facetas: FacetasResolvidas,
  activeCozinhas: ReadonlySet<string>,
): EffectiveFacets {
  const params: Record<string, string> = {}
  if (facetas.cozinhas?.length) params.cozinha = facetas.cozinhas.join(',')
  if (facetas.categorias?.length) params.categoria = facetas.categorias.join(',')
  if (facetas.tags?.length) params.tag = facetas.tags.join(',')
  if (facetas.restricoes?.length) params.restricao = facetas.restricoes.join(',')
  if (facetas.dificuldade?.min !== undefined) params.dificuldade_min = String(facetas.dificuldade.min)
  if (facetas.dificuldade?.max !== undefined) params.dificuldade_max = String(facetas.dificuldade.max)
  if (facetas.porcoes?.min !== undefined) params.porcoes_min = String(facetas.porcoes.min)
  if (facetas.porcoes?.max !== undefined) params.porcoes_max = String(facetas.porcoes.max)
  return parseFacetParams((k) => (k in params ? params[k] : null), activeCozinhas)
}

/**
 * Projeta as facetas resolvidas para o DTO `consulta` (só as chaves presentes).
 * CONTEXT.md: "Consulta"/"facetas resolvidas".
 */
function toFacetasResolvidasDTO(facetas: FacetasResolvidas): FacetasResolvidasDTO {
  const dto: FacetasResolvidasDTO = {}
  if (facetas.cozinhas?.length) dto.cozinhas = [...facetas.cozinhas]
  if (facetas.categorias?.length) dto.categorias = [...facetas.categorias]
  if (facetas.tags?.length) dto.tags = [...facetas.tags]
  if (facetas.restricoes?.length) dto.restricoes = [...facetas.restricoes]
  if (facetas.dificuldade !== undefined) dto.dificuldade = { ...facetas.dificuldade }
  if (facetas.porcoes !== undefined) dto.porcoes = { ...facetas.porcoes }
  return dto
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const rawQ = url.searchParams.get('q') ?? ''
  // Canonicaliza o locale UMA vez na borda. O mesmo valor canônico alimenta o
  // loader (predicado SQL contra recipe_translation.locale, case-sensitive) e o
  // buildSearchResponse (projeção de display).
  const requestLocale = resolveLocale({ preferred: url.searchParams.get('locale') })

  // Estado neutro: query vazia/só-espaços → seções vazias, SEM tocar o DB.
  // Neutraliza bytes de controle C0 (inclusive NUL U+0000, que sobrevive ao trim()
  // e seria bindado cru no postgres-js → o Postgres rejeita NUL em param text ANTES
  // do websearch_to_tsquery, virando 500 e violando o AC5 "vazio seguro, sem erro de
  // sistema"). Substitui por ESPAÇO (não vazio) para preservar fronteira de token;
  // tab/newline→espaço é inócuo p/ busca; query só-controle colapsa em '' → neutro.
  // `stripControlChars` (search-terms.ts) define a classe C0 UMA vez, com a forma
  // VISÍVEL \x00-\x1f, mantendo este arquivo text-diffável.
  const q0 = stripControlChars(rawQ).trim()

  // db hoisted UMA vez (reusado pelo conjunto-ativo de cozinhas E pelo searchRecipes adiante).
  const db = getDb()

  // #316: conjunto ATIVO de cozinhas, data-driven da tabela `vocabulary_term`. A leitura (faceta)
  // PODE usar o cache (`loadVocabulary`, ADR-0025: cache permitido em leituras). Mas o load NÃO pode
  // ser incondicional: o `await` quebraria o invariante do caminho neutro (q vazio sem faceta → SEM
  // tocar o DB) e regrediria o caminho 500-proof. Gatear só em `?cozinha` é insuficiente — a lente
  // de Perfil culinário resolve cozinha a partir do TEXTO LIVRE, sem param. Por isso gateamos em
  // `?cozinha` presente OU q0 não-vazio: aí (e SÓ aí) a faceta de cozinha pode importar. Quando
  // false, não há param de cozinha E a lente não roda em q vazio ⇒ o conjunto VAZIO é são e o
  // early-return neutro segue sem tocar o DB. Pós-virada #318 a coluna `recipe.cozinha` é `text`
  // (cast `::text[]` na search.ts), então TODO slug ativo é um filtro válido — usa-se o conjunto
  // ATIVO CRU (sem enum-bounding; 'americana' agora filtra de verdade).
  const needsActiveSet = url.searchParams.get('cozinha') !== null || q0.length > 0
  const activeCozinhas: ReadonlySet<string> = needsActiveSet
    ? new Set((await loadVocabulary(db, 'cozinha', 'active')).map((v) => v.slug))
    : new Set<string>()

  // #10: facetas EXPLÍCITAS da URL (validadas/degradadas na borda; valor inválido NUNCA
  // 400/500, vira sem-filtro). Bindar string crua em coluna enum dispararia 22P02→500.
  const explicitFacets = parseFacetParams((k) => url.searchParams.get(k), activeCozinhas)

  // #10 lente Perfil culinário (AC4): SÓ roda quando NÃO há faceta explícita na URL.
  // Havendo qualquer faceta explícita, a lente é suprimida e as explícitas honradas
  // verbatim (modela a UI editando a Consulta e re-GETando com ?cozinha= explícito).
  const useLens = isFacetsEmpty(explicitFacets)
  const lens = useLens ? resolveCulinaryProfile(q0) : null

  // Facetas EFETIVAS: explícitas verbatim OU resolvidas pela lente.
  const facets: EffectiveFacets =
    lens?.resolved === true ? facetasFromResolution(lens.facetas, activeCozinhas) : explicitFacets

  // q efetivo: q-restante da lente quando a lente rodou; senão q0. Quando a lente roda mas
  // NÃO resolve (resolved=false), remainingQuery devolve q0 VERBATIM (vírgulas byte-a-byte)
  // ⇒ q idêntico ao de #9 ⇒ reduce-to-#9 intacto. Quando resolve, os termos restantes
  // voltam re-juntados por ', ' (parseSearchTerms re-splita por vírgula).
  const q = lens ? lens.remainingQuery : q0

  // Consulta a ECOAR (Fork A): só quando a lente resolveu intenção difusa. undefined
  // (NÃO {}) quando não resolveu ⇒ buildSearchResponse OMITE a chave (estado neutro).
  const consulta: FacetasResolvidasDTO | undefined =
    lens?.resolved === true ? toFacetasResolvidasDTO(lens.facetas) : undefined

  // #10: guarda do early-return neutro. Só dispara quando NÃO há NADA para buscar NEM
  // filtrar (nem texto NEM faceta). NÃO reusar o seletor `facetOnly` do loader: este
  // testa "ausência de sinal de texto" (cobre ?q=,,, e ?q=!!!), estritamente mais largo
  // que q.length===0 — são dois testes distintos.
  const hasFacets = !isFacetsEmpty(facets)
  if (q.length === 0 && !hasFacets) {
    // #116/own-label: shape neutro agora carrega a chave `minhas:[]` (3 seções).
    return Response.json({ minhas: [], catalogo: [], comunidade: [] })
  }

  // #9: modo de match (permissivo — qualquer valor != 'all' vira 'any').
  const mode = parseMatchMode(url.searchParams.get('match'))

  // #9 (anti-fan-out): corta q a MAX_QUERY_LEN ANTES do split por vírgula, senão um GET
  // anônimo com ?q= gigante dirige fan-out ILIMITADO pelo CROSS JOIN do ingredient_raw_hit.
  // parseSearchTerms re-sanitiza C0 por termo e capa a MAX_TERMS.
  const terms = parseSearchTerms(q.slice(0, MAX_QUERY_LEN))

  // Early-shape terms.length===0 (ex.: q=',,,'): q segue não-vazio (o título ainda pode
  // casar), mas N=0 no ramo 'all' (ov.overlap = 0) zeraria TODAS as linhas só-título
  // (ov.overlap=NULL no FULL OUTER JOIN). Forçar 'any' preserva o comportamento #6 puro.
  const effectiveMode = terms.length === 0 ? 'any' : mode

  // #14: o vetor da consulta sai numa etapa SEPARADA, ANTES do loader, e nunca lança: embedder que falha, saída
  // malformada (dimensão errada, NaN/Infinity — que estourariam o cast `::vector` fora daqui, 500) ou limite
  // estourado viram `null` ⇒ degradação graciosa (só-precisa, FTS + trigram). NÃO embeda q vazio (preserva o
  // neutro) nem o caminho faceta-only (q sem letra/dígito → o loader já trata queryVector como no-op). Erro de DB do
  // loader NÃO é capturado aqui (500).
  //
  // #643 (ADR-0057): o embedding é pago e a busca é aberta a visitante. `resolveSearchQueryVector` normaliza a
  // consulta, olha o cache (`search_query_embedding`, por HMAC da consulta) em paralelo com a sessão e, só na falta,
  // passa pelo limitador persistido (por conta ou por IP, e o teto global por minuto) antes de chamar o embedder.
  // Acima do limite: `null`, a mesma degradação de quando o Gemini falha — sem erro para a pessoa.
  //
  // Paralelo com a leitura da sessão abaixo: o cache não depende dela; o limitador espera o `viewerId`.
  const sessionP = requireSession(request)
  const vectorP: Promise<number[] | null> =
    q.length === 0
      ? Promise.resolve(null)
      : resolveSearchQueryVector(db, {
          q,
          ip: clientIpFromHeaders(request),
          viewerId: sessionP.then((g) => (g.ok ? g.session.user.id : undefined)),
          embedder: getEmbedder(),
        })

  // #16: ordenacao da Comunidade. Borda PERMISSIVA (degrada p/ 'relevancia', nunca 400).
  // So afeta a chave condicional do ORDER BY na Comunidade; o Catalogo ignora (ADR-0003).
  const sort = parseSort(url.searchParams.get('sort'))

  // #116: sessão OPCIONAL — anônimo (ou conta desativada) NÃO é 401 aqui, só não recebe
  // `viewerId`. LOGADO ⇒ a Busca inclui também as próprias Receitas (privadas inclusive).
  const [queryVector, g] = await Promise.all([vectorP, sessionP])
  const viewerId = g.ok ? g.session.user.id : undefined

  // ADR-0041 dec.3: `?restricaoPerfil=1` (SEM valores — a lista nunca anda em URL) pede as Restrições SALVAS
  // do logado como filtro default. Lidas aqui, da sessão; Visitante ⇒ ignorado. Só valem quando a pessoa NÃO
  // escolheu restrição à mão (a escolha dela manda). Ficam FORA das facetas explícitas: não suprimem a lente
  // de Perfil culinário nem entram no eco da `consulta` (decididos acima, sem elas), e não tiram a busca do
  // repouso (o early-return neutro já passou). Somam-se às da busca (o filtro é "declara todas").
  let restricoesPerfil: Restricao[] = []
  if (
    viewerId !== undefined &&
    url.searchParams.get(PARAM_RESTRICAO_PERFIL) === '1' &&
    explicitFacets.restricoes.length === 0
  ) {
    const [row] = await db
      .select({ restricoes: users.restricoes })
      .from(users)
      .where(eq(users.id, viewerId))
    restricoesPerfil = normalizarRestricoes(row?.restricoes)
  }
  const facetsAplicadas: EffectiveFacets =
    restricoesPerfil.length > 0
      ? { ...facets, restricoes: somarRestricoes(facets.restricoes, restricoesPerfil) }
      : facets

  const { hits, sugestoes } = await searchRecipes(db, {
    q,
    terms,
    mode: effectiveMode,
    requestLocale,
    facets: facetsAplicadas,
    queryVector,
    sort,
    viewerId,
  })
  // #116/own-label: `viewerId` deriva `isOwn` (owner == viewer) p/ separar a seção "Minhas".
  // Só o booleano `isOwn` é exposto no DTO — o `owner_id` cru NUNCA vaza pro cliente.
  const body = buildSearchResponse(hits, requestLocale, viewerId, consulta, sugestoes)
  if (restricoesPerfil.length > 0) {
    // Eco das salvas APLICADAS (só ao próprio titular, nesta resposta): a UI mostra o aviso "Mostrando só
    // receitas que declaram…" e marca a trilha sem precisar buscar a lista em separado.
    body.restricoesPerfil = restricoesPerfil
  }
  // LOGADO ⇒ a resposta é por-viewer (as próprias Receitas, privadas inclusive, `isOwn`, e o eco das
  // Restrições salvas), e a chave de cache de um intermediário é a URL: nunca cacheada (como `/api/cooks`).
  // Visitante: sem header, como sempre (resposta igual para todos). O caminho neutro (early-return acima)
  // não resolve a sessão de propósito — não toca o DB — e devolve o mesmo corpo vazio para todos.
  if (viewerId !== undefined) {
    return Response.json(body, { headers: { 'cache-control': 'private, no-store' } })
  }
  return Response.json(body)
}
