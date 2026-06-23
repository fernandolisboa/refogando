import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { eq } from 'drizzle-orm'
import { generateMetadata } from '@/app/[locale]/recipes/[id]/page'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * `generateMetadata` da rota de detalhe (#232/#233/#234) — a SUPERFÍCIE de fato shipada — contra
 * Postgres real. Os builders puros já são cobertos em `test/domain/recipe-seo.test.ts`; aqui
 * exercitamos a casca: `generateMetadata({ params })` REAL (importada da page), com DB semeado,
 * provando a junção carregamento-público + gate + builders SEM tocar `headers()`/`cookies()`.
 *
 * Casos cobertos:
 *  (a) slug público ELEGÍVEL ⇒ robots index/follow + canonical absoluto do slug do locale;
 *  (e) NÃO-elegível (playful / privada / removida pela moderação) ⇒ robots noindex, SEM canonical
 *      de conteúdo (não vaza nem indexa o caminho do dono);
 *  (g) `[id]` = UUID legado (não slug) ⇒ noindex (o render faz 308; o metadata NÃO pode emitir
 *      index — senão a forma legada indexaria por baixo do redirect).
 *
 * `generateMetadata` usa `getBaseUrlFromEnv()` (env-only); fixamos `APP_URL` p/ asserções estáveis.
 */

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

/** Chama `generateMetadata` com o shape de params do Next 16 (`Promise<{locale, id}>`). */
function metaFor(id: string, locale = 'pt-BR') {
  return generateMetadata({ params: Promise.resolve({ locale, id }) })
}

describe('generateMetadata — caminho público elegível (a)', () => {
  it('slug público ⇒ robots index/follow + canonical absoluto do slug do locale', async () => {
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Bolo Indexável',
      descricao: 'Um bolo que o Google indexa.',
      provenance: 'escrita_por_pessoa',
      slug: 'bolo-indexavel',
    })

    const meta = await metaFor('bolo-indexavel')
    const robots = robotsOf(meta)
    expect(robots.index).toBe(true)
    expect(robots.follow).toBe(true)
    expect(meta.alternates?.canonical).toBe(`${BASE}/pt-BR/recipes/bolo-indexavel`)
    expect(meta.openGraph?.title).toBe('Bolo Indexável')
  })
})

describe('generateMetadata — NÃO-elegível ⇒ noindex, sem canonical de conteúdo (e)', () => {
  it('receita PLAYFUL (resultKind=playful) ⇒ noindex e SEM canonical do slug', async () => {
    const { userId } = await seedSessionHeaders({ email: `meta-playful-${crypto.randomUUID()}@ex.com` })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private', // CHECK recipe_playful_private_chk exige private p/ playful
      resultKind: 'playful',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Goku no Bife',
      provenance: 'escrita_por_pessoa',
      slug: 'goku-no-bife-meta',
    })

    const meta = await metaFor('goku-no-bife-meta')
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    // fall-through do caminho do dono: metadataBase só, sem canonical de conteúdo.
    expect(meta.alternates?.canonical).toBeUndefined()
  })

  it('receita PRIVADA (visibility=private, com dono) ⇒ noindex e SEM canonical', async () => {
    const { userId } = await seedSessionHeaders({ email: `meta-private-${crypto.randomUUID()}@ex.com` })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'private',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Segredo do Dono',
      provenance: 'escrita_por_pessoa',
      slug: 'segredo-do-dono-meta',
    })

    const meta = await metaFor('segredo-do-dono-meta')
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
  })

  it('receita REMOVIDA pela moderação (moderationRemovedAt) ⇒ noindex e SEM canonical', async () => {
    const { userId } = await seedSessionHeaders({ email: `meta-removed-${crypto.randomUUID()}@ex.com` })
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: userId,
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Removida do Pool',
      provenance: 'escrita_por_pessoa',
      slug: 'removida-do-pool-meta',
    })
    // Remove do pool diretamente (as colunas saem juntas pelo CHECK de consistência).
    await db()
      .update(recipe)
      .set({ moderationRemovedAt: new Date(), moderatedBy: userId })
      .where(eq(recipe.id, recipeId))

    const meta = await metaFor('removida-do-pool-meta')
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
  })
})

describe('generateMetadata — `[id]` UUID legado ⇒ noindex (g)', () => {
  it('UUID legado (não slug) ⇒ robots noindex (o render 308-a; o metadata NÃO indexa)', async () => {
    // Mesmo sendo uma receita PÚBLICA, a FORMA legada por UUID não pode emitir index: o render faz o
    // permanentRedirect (308) pro slug canônico, e o metadata por baixo precisa ser noindex p/ não
    // indexar a URL legada (que será redirecionada). `generateMetadata` recebe um UUID ⇒
    // decideRecipeDetailRoute devolve `redirect-uuid` ⇒ cai no fall-through noindex sem tocar cookie.
    const recipeId = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
    })
    await seedTranslation({
      recipeId,
      locale: 'pt-BR',
      titulo: 'Pública por UUID',
      provenance: 'escrita_por_pessoa',
      slug: 'publica-por-uuid-meta',
    })

    // `recipeId` é um UUID ⇒ a rota o trata como link legado, não como slug.
    const meta = await metaFor(recipeId)
    const robots = robotsOf(meta)
    expect(robots.index).toBe(false)
    expect(robots.follow).toBe(false)
    expect(meta.alternates?.canonical).toBeUndefined()
  })
})
