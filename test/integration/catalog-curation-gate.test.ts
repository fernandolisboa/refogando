import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { loadSitemapRecipes } from '@/server/recipe/sitemap'
import { loadFeed } from '@/server/recipe/feed'
import { loadPublicRecipeBySlug } from '@/server/recipe/load'
import { eq } from 'drizzle-orm'
import { recipeTranslation } from '@/db/schema'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { GET as searchRoute } from '@/app/api/search/route'
import { POST as deriveRoute } from '@/app/api/recipes/[id]/derive/route'
import { POST as translationsGet } from '@/app/api/recipes/[id]/translations/[locale]/route'
import { POST as translationsReview } from '@/app/api/recipes/[id]/translations/[locale]/review/route'
import { GET as staleQueue } from '@/app/api/curate/translations/stale/route'
import { POST as voteRoute } from '@/app/api/recipes/[id]/vote/route'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'
import type { CurationStatus } from '@/domain/recipe-curation'

/**
 * TESTE DE NÃO-VAZAMENTO (#238, ADR-0026) — o guard inegociável do gate de curadoria de catálogo.
 *
 * Um rascunho de catálogo (owner-null) em `pending`/`editing`/`rejected` é ESCONDIDO de TODA
 * superfície pública/comunidade; só `approved` aparece. O plan-review achou que a regra
 * "comunidade-visível" tem 4 espelhos fonte-única + 2 reimplementações, alcançados por superfícies
 * distintas — então este teste cobre CADA caminho que toca owner-null, não só os indexáveis:
 *  - INDEXAÇÃO: sitemap (loadSitemapRecipes), detalhe-por-slug (loadPublicRecipeBySlug).
 *  - DESCOBERTA: feed anônimo E feed viewer-logado (loadFeed — `viewerReadableSqlFragment`, os DOIS
 *    ramos owner-null), Busca (rota /api/search).
 *  - POR-UUID: GET /api/recipes/[id] (`isCommunityVisible` — vazaria o draft cru a anônimo),
 *    derive/fork (`isCommunityVisible` — forkaria o rascunho não-revisado, bypassando a curadoria).
 *
 * Faltar UM gate ⇒ este teste fica vermelho.
 */

const db = () => getDb()
const HIDDEN: CurationStatus[] = ['pending', 'editing', 'rejected']

async function seedCatalog(status: CurationStatus, token: string): Promise<{ id: string; slug: string }> {
  const id = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    curationStatus: status,
  })
  const slug = `${token}-${status}`
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: `${token} ${status}`,
    descricao: `Receita de ${token} no estado ${status}.`,
    provenance: status === 'approved' ? 'automatica_revisada' : 'automatica_nao_revisada',
    slug,
  })
  return { id, slug }
}

function getUuid(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function derive(id: string, headers: Headers): Promise<Response> {
  return deriveRoute(
    new Request(`http://localhost/api/recipes/${id}/derive`, { method: 'POST', headers, body: '{}' }),
    { params: Promise.resolve({ id }) },
  )
}

describe('Gate de curadoria de catálogo — rascunho não vaza em NENHUMA superfície', () => {
  it('INDEXAÇÃO: sitemap inclui só o catálogo APROVADO; pending/editing/rejected fora', async () => {
    const token = `sitemap${Date.now().toString(36)}`
    const approved = await seedCatalog('approved', token)
    const drafts = await Promise.all(HIDDEN.map((s) => seedCatalog(s, token)))

    const rows = await loadSitemapRecipes(db())
    expect(rows.some((r) => r.recipeId === approved.id)).toBe(true)
    for (const d of drafts) {
      expect(rows.some((r) => r.recipeId === d.id)).toBe(false)
    }
  })

  it('INDEXAÇÃO: detalhe-por-slug retorna o APROVADO; null pros rascunhos', async () => {
    const token = `slug${Date.now().toString(36)}`
    const approved = await seedCatalog('approved', token)
    const drafts = await Promise.all(HIDDEN.map((s) => seedCatalog(s, token)))

    expect(await loadPublicRecipeBySlug(db(), approved.slug, 'pt-BR')).not.toBeNull()
    for (const d of drafts) {
      expect(await loadPublicRecipeBySlug(db(), d.slug, 'pt-BR')).toBeNull()
    }
  })

  it('DESCOBERTA: feed ANÔNIMO mostra só o aprovado; rascunhos fora', async () => {
    const token = `feedanon${Date.now().toString(36)}`
    const approved = await seedCatalog('approved', token)
    const drafts = await Promise.all(HIDDEN.map((s) => seedCatalog(s, token)))

    const rows = await loadFeed(db(), { requestLocale: 'pt-BR', limit: 200, cursor: null })
    expect(rows.some((r) => r.recipe_id === approved.id)).toBe(true)
    for (const d of drafts) {
      expect(rows.some((r) => r.recipe_id === d.id)).toBe(false)
    }
  })

  it('DESCOBERTA: feed VIEWER-LOGADO também esconde os rascunhos (ramo owner-null do viewerReadable)', async () => {
    const token = `feedviewer${Date.now().toString(36)}`
    const { userId } = await seedSessionHeaders({ email: `feedviewer-${crypto.randomUUID()}@ex.com` })
    const approved = await seedCatalog('approved', token)
    const drafts = await Promise.all(HIDDEN.map((s) => seedCatalog(s, token)))

    const rows = await loadFeed(db(), { requestLocale: 'pt-BR', limit: 200, cursor: null, viewerId: userId })
    expect(rows.some((r) => r.recipe_id === approved.id)).toBe(true)
    for (const d of drafts) {
      expect(rows.some((r) => r.recipe_id === d.id)).toBe(false)
    }
  })

  it('DESCOBERTA: Busca (/api/search) acha o aprovado; nunca os rascunhos', async () => {
    const token = `buscax${Date.now().toString(36)}`
    const approved = await seedCatalog('approved', token)
    const drafts = await Promise.all(HIDDEN.map((s) => seedCatalog(s, token)))

    const res = await searchRoute(new Request(`http://localhost/api/search?q=${token}`))
    expect(res.status).toBe(200)
    const text = JSON.stringify(await res.json())
    expect(text).toContain(approved.id)
    for (const d of drafts) {
      expect(text).not.toContain(d.id)
    }
  })

  it('POR-UUID: GET /api/recipes/[id] 200 pro aprovado; 404 pros rascunhos (anônimo)', async () => {
    const token = `getuuid${Date.now().toString(36)}`
    const approved = await seedCatalog('approved', token)
    expect((await getUuid(approved.id)).status).toBe(200)
    for (const s of HIDDEN) {
      const d = await seedCatalog(s, token)
      expect((await getUuid(d.id)).status).toBe(404)
    }
  })

  it('POR-UUID: derive/fork 404 pro rascunho (não forka draft não-revisado, bypass da curadoria)', async () => {
    const token = `derive${Date.now().toString(36)}`
    const { headers } = await seedSessionHeaders({ email: `derive-${crypto.randomUUID()}@ex.com` })

    const approved = await seedCatalog('approved', token)
    expect((await derive(approved.id, headers)).status).not.toBe(404) // catálogo aprovado é forkável

    for (const s of HIDDEN) {
      const d = await seedCatalog(s, token)
      expect((await derive(d.id, headers)).status).toBe(404)
    }
  })
})

/**
 * Regressão (MED-2 do code-review): superfícies owner-null que o teste acima não cobria. O fixture
 * `seedRecipe` nasce `approved` p/ owner-null, então sem estes casos um caller que ESQUECESSE de
 * passar `curation_status` passaria verde. Cada caso exercita um ESPELHO distinto (isCommunityVisible
 * ×2, eligibleForPool, communityVisibleCondition) com um rascunho PENDING.
 */
describe('Gate de curadoria — tradução / pool / fila-stale escondem o rascunho', () => {
  it('tradução read (logado não-dono): 404 pro rascunho, ≠404 pro aprovado', async () => {
    const token = `tr${Date.now().toString(36)}`
    const { headers } = await seedSessionHeaders({ email: `tr-${crypto.randomUUID()}@ex.com` })
    const approved = await seedCatalog('approved', token)
    const pending = await seedCatalog('pending', token)
    const get = (id: string) =>
      translationsGet(new Request(`http://localhost/api/recipes/${id}/translations/pt-BR`, { method: 'POST', headers }), {
        params: Promise.resolve({ id, locale: 'pt-BR' }),
      })
    expect((await get(pending.id)).status).toBe(404)
    expect((await get(approved.id)).status).not.toBe(404)
  })

  it('tradução review (curador): 404 pro rascunho', async () => {
    const token = `rv${Date.now().toString(36)}`
    const { headers } = await seedSessionHeaders({ email: `rv-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const pending = await seedCatalog('pending', token)
    const res = await translationsReview(
      new Request(`http://localhost/api/recipes/${pending.id}/translations/en-US/review`, { method: 'POST', headers }),
      { params: Promise.resolve({ id: pending.id, locale: 'en-US' }) },
    )
    expect(res.status).toBe(404)
  })

  it('pool (voto): 404 pro rascunho; aprovado é votável', async () => {
    const token = `vt${Date.now().toString(36)}`
    const { headers } = await seedSessionHeaders({ email: `vt-${crypto.randomUUID()}@ex.com` })
    const approved = await seedCatalog('approved', token)
    const pending = await seedCatalog('pending', token)
    const vote = (id: string) =>
      voteRoute(new Request(`http://localhost/api/recipes/${id}/vote`, { method: 'POST', headers }), {
        params: Promise.resolve({ id }),
      })
    expect((await vote(pending.id)).status).toBe(404)
    expect((await vote(approved.id)).status).not.toBe(404)
  })

  it('fila de tradução stale (curador): exclui o rascunho, inclui o aprovado', async () => {
    const token = `st${Date.now().toString(36)}`
    const { headers } = await seedSessionHeaders({ email: `st-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    const approved = await seedCatalog('approved', token)
    const pending = await seedCatalog('pending', token)
    await getDb().update(recipeTranslation).set({ stale: true }).where(eq(recipeTranslation.recipeId, approved.id))
    await getDb().update(recipeTranslation).set({ stale: true }).where(eq(recipeTranslation.recipeId, pending.id))
    const res = await staleQueue(new Request('http://localhost/api/curate/translations/stale', { headers }))
    const text = JSON.stringify(await res.json())
    expect(text).toContain(approved.id)
    expect(text).not.toContain(pending.id)
  })
})
