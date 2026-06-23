/**
 * Decisão PURA de roteamento da página de detalhe da Receita por SLUG (#230, ADR-0020).
 *
 * A URL canônica do detalhe é `/{locale}/recipes/<slug>` — NUNCA o UUID (decisão 4). O segmento
 * dinâmico `[id]` da rota carrega OU um slug per-locale OU, em links LEGADOS, o UUID interno.
 * Este módulo é a casca testável (projeto "ui", sem DB nem `next/*`) que separa os dois casos:
 *
 *  - param com FORMA de UUID → link legado: a canonicalização PERMANENTE UUID→slug é um **301**
 *    LITERAL emitido no `proxy` (runtime nodejs, igual ao 301 de normalização de case já lá) —
 *    NÃO um `permanentRedirect` de Server Component (que serve 308). O proxy resolve o slug
 *    PÚBLICO daquele locale e 301-a; se a Receita NÃO é leitura pública (privada/playful/removida
 *    OU sem slug), o proxy NÃO redireciona e deixa a página tratar o UUID pelo caminho do DONO
 *    (cookie, leak-safe). O UUID continua chave interna/da API de dados, jamais URL pública.
 *  - qualquer outra forma → tratado como SLUG: a página renderiza o detalhe PÚBLICO via leitura
 *    anônima e cacheável (`loadPublicRecipeBySlug`), sem cookie/sessão.
 *
 * NÃO toca DB: a resolução slug→receita (uuid) e a leitura pública (slug) vivem na borda
 * (`src/server/recipe/load.ts`); aqui só a decisão de forma, mais o predicado PURO do gate de
 * leitura PÚBLICA (= gate de indexação default-open). Esse predicado é a fonte única reusada
 * pelo sitemap/robots/hreflang (#233) — visibilidade pública/catálogo E não-`playful` E não-removida.
 */
import { UUID_RE } from '@/server/http/params'
import { SUPPORTED_LOCALES } from '@/i18n/locale'

/**
 * Status do redirect do link LEGADO `/{locale}/recipes/<uuid>` → slug canônico: **301**
 * (permanente), emitido como 301 LITERAL no proxy (ADR-0020 decisão 4; a troça UUID→slug é
 * permanente, ao contrário do 302 da detecção de locale). Mesmo valor do 301 de normalização
 * de case (`LOCALE_CASE_REDIRECT_STATUS`), mas nomeado à parte para deixar a intenção explícita.
 */
export const LEGACY_UUID_REDIRECT_STATUS = 301 as const

/** `true` se o param da rota tem a forma de um UUID (link legado a canonicalizar). Sem tocar DB. */
export function isUuidParam(idParam: string): boolean {
  return UUID_RE.test(idParam)
}

/**
 * Decisão de rota a partir do param `[id]` cru:
 *  - `{ kind: 'owner-uuid', uuid }` — link LEGADO por UUID que chegou na PÁGINA (o proxy só 301-a
 *    UUIDs PÚBLICOS; um UUID que ainda chega aqui é privado/playful/removido/sem-slug). Trata pelo
 *    caminho do DONO (cookie, leak-safe) — NÃO redireciona (o 301 público já aconteceu no proxy).
 *  - `{ kind: 'slug', slug }` — renderizar o detalhe público por slug (leitura anônima/cacheável).
 *
 * Determinística e PURA: a forma do param é o único insumo. O caller (a page) executa o I/O
 * conforme o `kind` — caminho do dono (uuid) ou ler+renderizar (slug). A canonicalização
 * permanente UUID→slug (301) NÃO mora aqui: é do proxy (DB-direto, gateado, `NextResponse.redirect`).
 */
export type RecipeDetailRoute =
  | { kind: 'owner-uuid'; uuid: string }
  | { kind: 'slug'; slug: string }

export function decideRecipeDetailRoute(idParam: string): RecipeDetailRoute {
  if (isUuidParam(idParam)) return { kind: 'owner-uuid', uuid: idParam }
  return { kind: 'slug', slug: idParam }
}

/** Monta a URL canônica de detalhe `/{locale}/recipes/<slug>` (caminho relativo, p/ redirect). */
export function recipeDetailPath(locale: string, slug: string): string {
  return `/${locale}/recipes/${slug}`
}

/**
 * Parser PURO do caminho de detalhe LEGADO por UUID — alimenta o **301** do proxy (#230, ADR-0020
 * decisão 4). Reconhece `/{locale}/recipes/<uuid>` (locale na forma canônica EXATA, já normalizada
 * pelo redirect de case do proxy) e devolve `{ locale, uuid }`; qualquer outra forma → `null`
 * (slug, sub-rotas, locale ausente/mau-case). Sem tocar DB nem `next/*`: a forma do path é o único
 * insumo, então o proxy fica fino e a decisão é testável no projeto "ui".
 *
 * Só casa o locale JÁ canônico: um `/pt-br/recipes/<uuid>` é primeiro 301-normalizado pelo case e
 * só então reconhecido aqui (evita encadear dois redirects numa resposta só).
 */
export function parseLegacyUuidDetailPath(
  pathname: string,
): { locale: string; uuid: string } | null {
  const segments = pathname.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  // Exatamente `{locale}/recipes/{uuid}` — 3 segmentos, sem sub-rota.
  if (segments.length !== 3) return null
  const [locale, recipes, id] = segments
  if (recipes !== 'recipes') return null
  if (!SUPPORTED_LOCALES.includes(locale as (typeof SUPPORTED_LOCALES)[number])) return null
  if (!isUuidParam(id)) return null
  return { locale, uuid: id }
}

/**
 * Gate de leitura PÚBLICA da Receita — predicado PURO single-source (#230, ADR-0020 decisão 6).
 *
 * É O MESMO gate que decide INDEXABILIDADE (default-open, SEM humano no meio): uma Receita é
 * lida anonimamente / entra no sitemap/hreflang quando, e só quando:
 *   - é de **comunidade** — `owner_id IS NULL` (Catálogo editorial, ADR-0011) OU `visibility =
 *     'public'` (Receita publicada por um usuário) —, E
 *   - é **não-`playful`** (`result_kind <> 'playful'`), E
 *   - **não foi removida pela moderação** (`moderation_removed_at IS NULL`).
 *
 * O eixo de comunidade é a MESMA regra de `isCommunityVisible` (`owner_id IS NULL OR
 * visibility='public'`) que o GET por uuid (`/api/recipes/[id]`) já aplica — NÃO `visibility =
 * 'public'` estrito. Isso É carregado de propósito: o **Catálogo nasce `visibility='private'`
 * + `owner_id NULL`** (ver `createCatalogRecipe`: a leitura abre pelo owner-NULL, sem setar
 * 'public'), então um gate estrito em `visibility` excluiria o Catálogo inteiro da leitura por
 * slug E do índice — contradizendo a EXCEÇÃO EDITORIAL do ADR decisão 6 ("o catálogo é curado
 * por nós, é editorial, é indexado"). Casar a regra de comunidade do GET garante que a leitura
 * por SLUG e a leitura por UUID concordem sobre o que é público (sem o split-brain que
 * 404-aria o Catálogo por slug enquanto ele renderiza por uuid).
 *
 * `playful`/moderação somam os outros dois eixos do gate de índice (default-open) — esta é a
 * fonte única reusada pelo sitemap/robots/hreflang de #233.
 *
 * NÃO lê cookie/sessão: o gate é o mesmo para o crawler e para qualquer anônimo. Sessão de DONO
 * é um caminho SEPARADO (dinâmico, com cookie) que NÃO passa por aqui.
 */
export function eligibleForPublicRead(r: {
  ownerId: string | null
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
}): boolean {
  const community = r.ownerId == null || r.visibility === 'public'
  return community && r.resultKind !== 'playful' && r.moderationRemovedAt == null
}
