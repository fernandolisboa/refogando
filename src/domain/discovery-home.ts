/**
 * Núcleo PURO da Descoberta-home (#236, ADR-0020) — sem DB, sem React, sem `next/*` além do TIPO
 * `Metadata`. "A Descoberta é a home": `/{locale}` é um feed server-rendered e INDEXÁVEL em estado de
 * REPOUSO; a Busca refina INLINE a mesma superfície. O estado de repouso indexa; qualquer estado
 * REFINADO (busca/filtro) é `noindex`.
 *
 * Dois kernels PUROS aqui (a casca — `page.tsx`/`generateMetadata` — carrega o I/O e os chama):
 *  - `isRefinedHomeParams` — decide REPOUSO vs REFINADO a partir dos `searchParams` crus. Único insumo:
 *    a presença de QUALQUER parâmetro de busca/filtro. Determinística (governa o gate de índice).
 *  - `buildHomeMetadata` — o objeto `Metadata` do Next pra home: REPOUSO ⇒ `robots {index,follow}` +
 *    `alternates.canonical = /{locale}` + hreflang dos locales + `x-default → /` (raiz redirecionadora,
 *    ADR-0020 dec.5) + OG de MARCA; REFINADO ⇒ `robots {noindex,nofollow}` (sem canonical de conteúdo,
 *    não indexa o estado de busca).
 *
 * O hreflang da home espelha EXATAMENTE `buildStaticLocaleEntries` do sitemap (#235): cada home lista
 * as outras + `x-default → raiz /` (que negocia o idioma por Accept-Language). NÃO duplica a regra —
 * mesma forma, mesma fonte (`SUPPORTED_LOCALES`/`DEFAULT_LOCALE`). REUSA `getBaseUrlFromEnv` (env-only)
 * na casca: tocar `headers()` no caminho de repouso mataria a cacheabilidade do caminho indexável.
 */
import type { Metadata } from 'next'
import { SUPPORTED_LOCALES, type Locale } from '@/i18n/locale'

/** Asset estável do card de MARCA (#232/#236) — OG da home (a Descoberta não tem foto canônica). */
const BRAND_OG_IMAGE_PATH = '/opengraph-image.png'

/**
 * Os parâmetros de busca/filtro que, presentes, marcam a home como REFINADA (= `noindex`). É a MESMA
 * lista que `SearchExperience` reflete na URL ao buscar/filtrar (`q` + as três facetas + `sort`): o
 * estado de repouso indexável é o SEM nenhum deles. Centralizado aqui pra a página e o cliente nunca
 * divergirem sobre "o que conta como refino".
 */
export const REFINEMENT_PARAM_KEYS = ['q', 'cozinha', 'categoria', 'restricao', 'sort'] as const

/**
 * Forma crua de `searchParams` do Next 16: cada chave é `string | string[] | undefined` (multivalor
 * vira array). Aceitamos o shape genérico pra o predicado funcionar tanto no `generateMetadata` quanto
 * em qualquer normalização de borda.
 */
export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * `true` se há QUALQUER refino ativo (busca/filtro) ⇒ a home é REFINADA (`noindex`). Repouso = NENHUM
 * dos `REFINEMENT_PARAM_KEYS` presente E não-vazio. Um param presente porém VAZIO (`?q=`) NÃO conta
 * como refino (string vazia = sem critério, espelha o `hasCriteria` do `SearchExperience`): assim um
 * link com `?q=` pendurado não derruba a indexação do repouso à toa. Multivalor (array) conta quando
 * tem ao menos um item não-vazio.
 */
export function isRefinedHomeParams(searchParams: RawSearchParams | undefined): boolean {
  if (!searchParams) return false
  for (const key of REFINEMENT_PARAM_KEYS) {
    const raw = searchParams[key]
    if (raw === undefined) continue
    const values = Array.isArray(raw) ? raw : [raw]
    if (values.some((v) => typeof v === 'string' && v.trim() !== '')) return true
  }
  return false
}

/** Insumo do builder de metadados da home — dados JÁ resolvidos pela casca (sem I/O aqui). */
export type HomeMetadataInput = {
  /** Locale CORRENTE da home (governa canonical `/{locale}` e og:locale). */
  locale: Locale
  /** Base URL absoluta BUILD-SAFE (env-only, sem `headers()`). Ex.: `https://refogando.com`. */
  baseUrl: string
  /** Título da home (chrome localizada). */
  title: string
  /** Descrição da home (chrome localizada). */
  description: string
  /** Nome da marca p/ o `siteName` do OG. */
  brandName: string
  /**
   * Estado REFINADO (busca/filtro ativo)? `true` ⇒ `noindex/nofollow` + sem canonical de conteúdo (o
   * estado de busca não indexa). `false` (repouso) ⇒ index/follow + canonical `/{locale}` + hreflang.
   */
  refined: boolean
}

/** URL absoluta da home por locale (`<base>/{locale}`) — espelha `buildStaticLocaleEntries`. */
function absoluteHomeUrl(baseUrl: string, locale: string): string {
  return `${baseUrl}/${locale}`
}

/**
 * Mapa hreflang da home: cada locale suportado → `<base>/{locale}` + `x-default → <base>/` (a RAIZ
 * redirecionadora que negocia o idioma por Accept-Language, ADR-0020 dec.5). MESMA forma de
 * `buildStaticLocaleEntries` (#235) — fonte única (`SUPPORTED_LOCALES`), sem inventar locale.
 */
export function homeHreflangAlternates(baseUrl: string): Record<string, string> {
  const langs: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) langs[loc] = absoluteHomeUrl(baseUrl, loc)
  langs['x-default'] = `${baseUrl}/`
  return langs
}

/**
 * #236 — objeto `Metadata` do Next pra HOME-Descoberta. metadataBase = baseUrl build-safe; título/
 * descrição da chrome; OG de MARCA (a Descoberta não tem foto canônica — usa o card de marca).
 *
 * REPOUSO (`refined === false`): `robots {index, follow}` + `alternates.canonical = /{locale}` +
 * `alternates.languages` (todos os locales + `x-default → /`). É o estado indexável (= mesmo pool do
 * sitemap #235).
 *
 * REFINADO (`refined === true`): `robots {index:false, follow:false}` e SEM `alternates` de conteúdo —
 * o estado de busca/filtro NÃO indexa (ADR-0020: só o repouso indexa). metadataBase permanece (links
 * absolutos consistentes). NUNCA toca `headers()` (a casca usa `getBaseUrlFromEnv`).
 */
export function buildHomeMetadata(input: HomeMetadataInput): Metadata {
  const { locale, baseUrl, title, description, brandName, refined } = input

  if (refined) {
    // Estado de busca/filtro: noindex, sem canonical/hreflang de conteúdo.
    return {
      metadataBase: new URL(baseUrl),
      title,
      description,
      robots: { index: false, follow: false },
    }
  }

  const canonical = absoluteHomeUrl(baseUrl, locale)
  const ogImageUrl = `${baseUrl}${BRAND_OG_IMAGE_PATH}`
  return {
    metadataBase: new URL(baseUrl),
    title,
    description,
    alternates: {
      canonical,
      languages: homeHreflangAlternates(baseUrl),
    },
    openGraph: {
      type: 'website',
      title,
      description,
      url: canonical,
      siteName: brandName,
      locale,
      images: [{ url: ogImageUrl, alt: brandName }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImageUrl],
    },
    robots: { index: true, follow: true },
  }
}
