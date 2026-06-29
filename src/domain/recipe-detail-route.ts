/**
 * Decisão PURA de roteamento da página de detalhe da Receita por SLUG (#230, ADR-0020).
 *
 * A URL canônica do detalhe é `/{locale}/recipes/<slug>` — NUNCA o UUID (decisão 4). O segmento
 * dinâmico `[id]` da rota carrega OU um slug per-locale OU, em links LEGADOS, o UUID interno.
 * Este módulo é a casca testável (projeto "ui", sem DB nem `next/*`) que separa os dois casos:
 *
 *  - param com FORMA de UUID → link legado: a canonicalização PERMANENTE UUID→slug é um
 *    `permanentRedirect` do Server Component (que serve **308** no Next 16) — NÃO um 301 literal no
 *    proxy. O server component resolve o slug PÚBLICO (gateado) daquele locale e 308-a; se a Receita
 *    NÃO é leitura pública (privada/playful/removida OU sem slug), NÃO redireciona e cai no caminho
 *    do DONO (cookie, leak-safe) — não vaza slug nem existência. O UUID continua chave interna/da
 *    API de dados, jamais URL pública. (308 e 301 são idênticos p/ o Google: canonicalização
 *    permanente, cacheável, passa link equity — o ADR diz "301" como sinônimo de "permanente, ao
 *    contrário do 302 da detecção"; o `permanentRedirect` honra esse intento E mantém o gate "no
 *    server component" do ADR, sem DB no proxy.)
 *  - qualquer outra forma → tratado como SLUG: a página renderiza o detalhe PÚBLICO via leitura
 *    anônima e cacheável (`loadPublicRecipeBySlug`), sem cookie/sessão.
 *
 * NÃO toca DB: a resolução slug→receita (uuid) e a leitura pública (slug) vivem na borda
 * (`src/server/recipe/load.ts`); aqui só a decisão de forma, mais o predicado PURO do gate de
 * leitura PÚBLICA (= gate de indexação default-open). Esse predicado é a fonte única reusada
 * pelo sitemap/robots/hreflang (#233) — visibilidade pública/catálogo E não-`playful` E não-removida.
 */
import { UUID_RE } from '@/server/http/params'
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'
import { isCatalogPubliclyCurated, type CurationStatus } from '@/domain/recipe-curation'

/**
 * Status do redirect do link LEGADO `/{locale}/recipes/<uuid>` → slug canônico: **308**
 * (permanente), emitido por `permanentRedirect` no Server Component (ADR-0020 decisão 4; a troça
 * UUID→slug é permanente, ao contrário do 302 da detecção de locale). O ADR escreve "301", mas o
 * Next emite o redirect PERMANENTE idiomático de Server Component como 308 — equivalente p/ SEO
 * (permanente, cacheável, consolida link equity), e mantém o gate "no server component" do ADR
 * (sem DB no proxy). Nomeado à parte para deixar a intenção (permanente, ≠ 302) explícita.
 */
export const LEGACY_UUID_REDIRECT_STATUS = 308 as const

/** `true` se o param da rota tem a forma de um UUID (link legado a canonicalizar). Sem tocar DB. */
export function isUuidParam(idParam: string): boolean {
  return UUID_RE.test(idParam)
}

/**
 * Decisão de rota a partir do param `[id]` cru:
 *  - `{ kind: 'redirect-uuid', uuid }` — link LEGADO por UUID: o Server Component resolve o slug
 *    PÚBLICO (gateado) do locale e dá um `permanentRedirect` (308). Se a Receita NÃO é leitura
 *    pública (privada/playful/removida/sem-slug), NÃO redireciona e cai no caminho do DONO (cookie,
 *    leak-safe) — não vaza slug nem existência.
 *  - `{ kind: 'slug', slug }` — renderizar o detalhe público por slug (leitura anônima/cacheável).
 *
 * Determinística e PURA: a forma do param é o único insumo. O caller (a page) executa o I/O
 * conforme o `kind` — resolver+redirecionar/owner (uuid) ou ler+renderizar (slug).
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

/** URL ABSOLUTA canônica do detalhe `<base>/{locale}/recipes/{slug}`. */
export function absoluteRecipeDetailUrl(baseUrl: string, locale: string, slug: string): string {
  return `${baseUrl}${recipeDetailPath(locale, slug)}`
}

/**
 * Mapa hreflang `{ locale → url, x-default → url(DEFAULT_LOCALE) }` da Receita por SLUG — fonte ÚNICA
 * reusada pelo `alternates.languages` do detalhe (#233, `buildRecipeMetadata`) E por cada entrada do
 * SITEMAP (#235). SÓ entram os locales presentes em `slugsByLocale` (= têm tradução pública com slug):
 * NUNCA inventamos URL de locale inexistente. x-default aponta pro DEFAULT_LOCALE quando ele tem slug;
 * senão pro primeiro locale suportado presente (degrade gracioso — não deixa o x-default apontar pra um
 * locale inexistente).
 *
 * DIVERGÊNCIA CONSCIENTE do ADR-0020 decisão 5: no DETALHE/sitemap o x-default aponta pra URL da
 * receita no DEFAULT_LOCALE (não pra raiz `/` da home) — não há redirecionador por-receita; ver a nota
 * de implementação na decisão 5 do ADR-0020.
 */
export function recipeHreflangAlternates(
  baseUrl: string,
  slugsByLocale: Partial<Record<Locale, string>>,
): Record<string, string> {
  const langs: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) {
    const slug = slugsByLocale[loc]
    if (slug) langs[loc] = absoluteRecipeDetailUrl(baseUrl, loc, slug)
  }
  // x-default: prioriza o DEFAULT_LOCALE; se ele não tiver slug, usa o primeiro presente.
  const defaultSlug =
    slugsByLocale[DEFAULT_LOCALE] ?? SUPPORTED_LOCALES.map((l) => slugsByLocale[l]).find(Boolean)
  const defaultLocaleForX = slugsByLocale[DEFAULT_LOCALE]
    ? DEFAULT_LOCALE
    : SUPPORTED_LOCALES.find((l) => slugsByLocale[l])
  if (defaultSlug && defaultLocaleForX) {
    langs['x-default'] = absoluteRecipeDetailUrl(baseUrl, defaultLocaleForX, defaultSlug)
  }
  return langs
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
  curationStatus: CurationStatus
}): boolean {
  // #238/ADR-0026: o ramo CATÁLOGO (owner-null) só é leitura pública/indexável quando CURADO
  // (`approved`). Um rascunho pending/editing/rejected NÃO é público (nem no detalhe-por-slug,
  // nem no sitemap/hreflang/JSON-LD, que reusam este predicado). `curationStatus` obrigatório
  // no input ⇒ o compilador acha todo caller (load.ts/sitemap.ts/page) — fail-closed.
  const community =
    (r.ownerId == null && isCatalogPubliclyCurated(r.curationStatus)) || r.visibility === 'public'
  return community && r.resultKind !== 'playful' && r.moderationRemovedAt == null
}
