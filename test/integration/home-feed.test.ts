import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ComponentType, type ReactElement, type ReactNode } from 'react'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Home-Descoberta (#236, ADR-0020) — "a Descoberta é a home". O estado de REPOUSO de `/{locale}`
 * server-renderiza o feed do POOL PÚBLICO (anônimo, SEM cookie → cacheável/indexável, MESMO pool do
 * sitemap/detalhe #230/#235), e a Busca refina INLINE. Provado contra Postgres real (projeto "node"):
 *
 *  - SSR de repouso: a página (Server Component) renderiza, no HTML, os itens do pool público
 *    (catálogo + comunidade pública aparecem; playful / privada-de-outro / removida NÃO) — o que o
 *    crawler vê SEM JS. O viewer é ANÔNIMO (a página NÃO lê cookie no caminho de repouso).
 *  - `generateMetadata`: repouso (sem params) ⇒ robots index/follow + canonical `/{locale}` +
 *    hreflang/x-default; refinado (`?q=` / faceta) ⇒ noindex.
 *
 * O Server Component da home monta o `<SearchExperience>` (client) seedado com a 1ª página do feed; o
 * Next o SSR-renderiza com `initialFeed` (é o HTML indexável). Pra renderizar o cliente FORA do Next,
 * mockamos suas seams de browser (`next/navigation`/`@/lib/auth-client`) e envolvemos no `LocaleProvider`
 * (o que o layout faz em produção) — `renderToStaticMarkup` então emite o HTML do feed seeded, sem
 * rodar efeitos (igual ao SSR).
 *
 * `generateMetadata`/o SSR usam `getBaseUrlFromEnv()` (env-only, sem `headers()`); fixamos `APP_URL`.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }),
}))

import Home, { generateMetadata } from '@/app/[locale]/page'
import { LocaleProvider } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'

const BASE = 'https://refogando.example'
const db = () => getDb()

let prevAppUrl: string | undefined

beforeAll(() => {
  prevAppUrl = process.env.APP_URL
  process.env.APP_URL = BASE
})

afterAll(() => {
  if (prevAppUrl === undefined) delete process.env.APP_URL
  else process.env.APP_URL = prevAppUrl
})

/** Narrow do `robots` (objeto na nossa rota) — evita o ruído das uniões do tipo Metadata. */
function robotsOf(meta: Awaited<ReturnType<typeof generateMetadata>>) {
  const r = meta.robots
  return typeof r === 'object' && r != null ? r : {}
}

/** Chama `generateMetadata` com o shape de params/searchParams do Next 16. */
function metaFor(searchParams: Record<string, string | string[]> = {}, locale = 'pt-BR') {
  return generateMetadata({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(searchParams),
  })
}

/** Renderiza o Server Component da home (async) a HTML estático — o que o crawler enxerga no repouso. */
async function renderHome(locale: Locale = 'pt-BR') {
  const el = (await Home({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve({}),
  })) as ReactElement
  // Envolve no LocaleProvider (o layout o faz em prod) pra os hooks de chrome do cliente resolverem.
  // `children` é passado como 3º arg de createElement (não como prop — evita o lint react/no-children-prop);
  // o cast pra `ComponentType<{ initialLocale: Locale }>` apaga a exigência de `children` na assinatura de
  // props do overload de createElement (o filho posicional já o supre).
  const Provider = LocaleProvider as ComponentType<{ initialLocale: Locale }>
  const Wrapper = () => createElement(Provider, { initialLocale: locale }, el as ReactNode)
  return renderToStaticMarkup(createElement(Wrapper))
}

describe('Home-Descoberta — SSR de repouso indexa o pool público (#236)', () => {
  it('repouso server-renderiza o feed do pool: catálogo + comunidade pública aparecem; playful/privada/removida NÃO', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: `home-owner-${crypto.randomUUID()}@ex.com` })
    const { userId: curator } = await seedSessionHeaders({
      email: `home-curator-${crypto.randomUUID()}@ex.com`,
      role: 'curador',
    })

    // Catálogo (owner NULL) — DEVE aparecer no HTML SSR.
    const cat = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, resultKind: 'success' })
    await seedTranslation({ recipeId: cat, locale: 'pt-BR', titulo: 'Feijoada Indexavel SSR', provenance: 'escrita_por_pessoa', slug: 'feijoada-indexavel-ssr' })

    // Comunidade pública — DEVE aparecer.
    const pub = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner, visibility: 'public', resultKind: 'success' })
    await seedTranslation({ recipeId: pub, locale: 'pt-BR', titulo: 'Strogonoff Publico SSR', provenance: 'escrita_por_pessoa', slug: 'strogonoff-publico-ssr' })

    // Privada de outro — NÃO aparece (viewer anônimo no SSR).
    const priv = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner, visibility: 'private', resultKind: 'success' })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Privada Oculta SSR', provenance: 'escrita_por_pessoa', slug: 'privada-oculta-ssr' })

    // Playful (catálogo owner-NULL) — NÃO aparece.
    const playful = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, visibility: 'private', resultKind: 'playful' })
    await seedTranslation({ recipeId: playful, locale: 'pt-BR', titulo: 'Zoeira Catalogo SSR', provenance: 'escrita_por_pessoa', slug: 'zoeira-catalogo-ssr' })

    // Removida por moderação — NÃO aparece.
    const removed = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: owner, visibility: 'public', resultKind: 'success' })
    await seedTranslation({ recipeId: removed, locale: 'pt-BR', titulo: 'Removida Pool SSR', provenance: 'escrita_por_pessoa', slug: 'removida-pool-ssr' })
    await db().update(recipe).set({ moderationRemovedAt: new Date(), moderatedBy: curator }).where(eq(recipe.id, removed))

    const html = await renderHome()

    // POSITIVO: o pool público está no HTML SSR (o crawler vê sem JS) + link canônico por slug.
    expect(html).toContain('Feijoada Indexavel SSR')
    expect(html).toContain('Strogonoff Publico SSR')
    expect(html).toContain('/pt-BR/recipes/feijoada-indexavel-ssr')

    // NEGATIVO não-vácuo: os seeds existem mas o gate de pool os mantém FORA do SSR.
    expect(html).not.toContain('Privada Oculta SSR')
    expect(html).not.toContain('Zoeira Catalogo SSR')
    expect(html).not.toContain('Removida Pool SSR')
  })
})

describe('Home-Descoberta — generateMetadata index vs noindex (#236)', () => {
  it('repouso (sem params) ⇒ robots index/follow + canonical /{locale} + hreflang/x-default', async () => {
    const meta = await metaFor({})
    const robots = robotsOf(meta)
    expect(robots.index).toBe(true)
    expect(robots.follow).toBe(true)
    expect(meta.alternates?.canonical).toBe(`${BASE}/pt-BR`)
    const langs = meta.alternates?.languages as Record<string, string> | undefined
    expect(langs?.['pt-BR']).toBe(`${BASE}/pt-BR`)
    expect(langs?.['en-US']).toBe(`${BASE}/en-US`)
    expect(langs?.['x-default']).toBe(`${BASE}/`)
  })

  it('refinado por BUSCA (?q=) ⇒ robots noindex, sem canonical de conteúdo', async () => {
    const meta = await metaFor({ q: 'bolo' })
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
  })

  it('refinado por FACETA (?cozinha=) ⇒ robots noindex', async () => {
    const meta = await metaFor({ cozinha: 'italiana' })
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
  })
})
