/**
 * Decisão PURA de roteamento da página de detalhe da Receita por SLUG (#230, ADR-0020).
 *
 * A URL canônica do detalhe é `/{locale}/recipes/<slug>` — NUNCA o UUID (decisão 4). O segmento
 * dinâmico `[id]` da rota carrega OU um slug per-locale OU, em links LEGADOS, o UUID interno.
 * Este módulo é a casca testável (projeto "ui", sem DB nem `next/*`) que separa os dois casos:
 *
 *  - param com FORMA de UUID → link legado: precisa RESOLVER o slug daquele locale e dar **301**
 *    (permanente) para o canônico `/{locale}/recipes/<slug>`. O UUID continua chave interna/da
 *    API de dados, jamais URL pública de página.
 *  - qualquer outra forma → tratado como SLUG: a página renderiza o detalhe PÚBLICO via leitura
 *    anônima e cacheável (`loadPublicRecipeBySlug`), sem cookie/sessão.
 *
 * NÃO toca DB: a resolução slug→receita (uuid) e a leitura pública (slug) vivem na borda
 * (`src/server/recipe/load.ts`); aqui só a decisão de forma, mais o predicado PURO do gate de
 * leitura PÚBLICA (= gate de indexação default-open). Esse predicado é a fonte única reusada
 * pelo sitemap/robots/hreflang (#233) — visibilidade pública E não-`playful` E não-removida.
 */
import { UUID_RE } from '@/server/http/params'

/** `true` se o param da rota tem a forma de um UUID (link legado a 301-ar). Sem tocar DB. */
export function isUuidParam(idParam: string): boolean {
  return UUID_RE.test(idParam)
}

/**
 * Decisão de rota a partir do param `[id]` cru:
 *  - `{ kind: 'redirect-uuid', uuid }` — link legado: resolver o slug do locale e **301**.
 *  - `{ kind: 'slug', slug }` — renderizar o detalhe público por slug (leitura anônima/cacheável).
 *
 * Determinística e PURA: a forma do param é o único insumo. O caller (a page) executa o I/O
 * conforme o `kind` — resolver+redirecionar (uuid) ou ler+renderizar (slug).
 */
export type RecipeDetailRoute =
  | { kind: 'redirect-uuid'; uuid: string }
  | { kind: 'slug'; slug: string }

export function decideRecipeDetailRoute(idParam: string): RecipeDetailRoute {
  if (isUuidParam(idParam)) return { kind: 'redirect-uuid', uuid: idParam }
  return { kind: 'slug', slug: idParam }
}

/** Monta a URL canônica de detalhe `/{locale}/recipes/<slug>` (caminho relativo, p/ redirect). */
export function recipeDetailPath(locale: string, slug: string): string {
  return `/${locale}/recipes/${slug}`
}

/**
 * Gate de leitura PÚBLICA da Receita — predicado PURO single-source (#230, ADR-0020 decisão 6).
 *
 * É O MESMO gate que decide INDEXABILIDADE (default-open, SEM humano no meio): uma Receita é
 * lida anonimamente / entra no sitemap/hreflang quando, e só quando:
 *   - **visibilidade pública** (`visibility = 'public'`), E
 *   - **não-`playful`** (`result_kind <> 'playful'`), E
 *   - **não removida pela moderação** (`moderation_removed_at IS NULL`).
 *
 * Distinto de `isCommunityVisible` (que conta Catálogo `owner_id NULL` como visível pela regra
 * `owner_id IS NULL OR visibility='public'`): aqui o Catálogo TAMBÉM passa porque o Catálogo é
 * `visibility='public'` por construção. Mantemos o predicado em termos EXPLÍCITOS dos três eixos
 * do ADR (visibility/playful/moderação) para ser a fonte única do gate de índice de #233 — sem
 * herdar a semântica owner-NULL de `isCommunityVisible`, que mistura leitura-de-acesso com pool.
 *
 * NÃO lê cookie/sessão: o gate é o mesmo para o crawler e para qualquer anônimo. Sessão de DONO
 * é um caminho SEPARADO (dinâmico, com cookie) que NÃO passa por aqui.
 */
export function eligibleForPublicRead(r: {
  visibility: string
  resultKind: string
  moderationRemovedAt: Date | null
}): boolean {
  return (
    r.visibility === 'public' &&
    r.resultKind !== 'playful' &&
    r.moderationRemovedAt == null
  )
}
