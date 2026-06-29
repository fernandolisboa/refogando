import { describe, it, expect } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, recipeTranslation } from '@/db/schema'
import { createCatalogRecipe } from '@/server/curate/create'
import {
  listCatalogCurationQueue,
  listRejectedCatalog,
  approveCatalogRecipe,
  rejectCatalogRecipe,
  startEditingCatalogRecipe,
  unrejectCatalogRecipe,
} from '@/server/curate/recipe-curation'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { seedRecipe } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Ações de CURADORIA de catálogo (#238, ADR-0026) contra Postgres real. Cobre o ciclo de vida
 * (pending→editing→approved/rejected→pending) + a honestidade do provenance: aprovar promove SÓ o
 * original_locale (en-US fica automatica_nao_revisada, ADR-0026 dec.5).
 */

const db = () => getDb()

async function seedBilingualPending(token: string): Promise<string> {
  const { recipeId } = await createCatalogRecipe(db(), {
    originalLocale: 'pt-BR',
    translations: [
      { locale: 'pt-BR', titulo: `${token} pt`, descricao: 'desc pt', passos: ['p1', 'p2'], notas: null, provenance: 'automatica_nao_revisada' },
      { locale: 'en-US', titulo: `${token} en`, descricao: 'desc en', passos: ['s1', 's2'], notas: null, provenance: 'automatica_nao_revisada' },
    ],
    cozinha: 'italiana',
    categoria: 'prato_principal',
    restricoes: [],
    porcoes: 4,
    dificuldade: 3,
    tempoAtivoMin: 20,
    tempoTotalMin: 40,
    ingredientes: [{ rawText: '200 g de massa', quantidade: '200', unidade: 'g' }],
    curationStatus: 'pending',
    reviewedBy: null,
  })
  return recipeId
}

async function statusOf(id: string): Promise<string> {
  const [r] = await db().select({ s: recipe.curationStatus }).from(recipe).where(eq(recipe.id, id))
  return r.s
}
async function provOf(id: string, locale: string): Promise<string> {
  const [r] = await db()
    .select({ p: recipeTranslation.provenance })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, id), eq(recipeTranslation.locale, locale)))
  return r.p
}

describe('createCatalogRecipe bilíngue', () => {
  it('insere 2 traduções com provenance própria e slugs congelados por locale', async () => {
    const id = await seedBilingualPending(`bil${Date.now().toString(36)}`)
    const trs = await db()
      .select({ locale: recipeTranslation.locale, prov: recipeTranslation.provenance, slug: recipeTranslation.slug })
      .from(recipeTranslation)
      .where(eq(recipeTranslation.recipeId, id))
    expect(trs).toHaveLength(2)
    for (const t of trs) {
      expect(t.prov).toBe('automatica_nao_revisada')
      expect(t.slug).toBeTruthy()
    }
    expect(await statusOf(id)).toBe('pending')
  })
})

describe('approveCatalogRecipe', () => {
  it('pending→approved: público, reviewed setado, promove SÓ o original (en-US fica não-revisado)', async () => {
    const token = `appr${Date.now().toString(36)}`
    const { userId } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com` })
    const id = await seedBilingualPending(token)

    // antes: escondido (GET-uuid 404)
    const before = await recipeGet(new Request(`http://localhost/api/recipes/${id}`), { params: Promise.resolve({ id }) })
    expect(before.status).toBe(404)

    const res = await approveCatalogRecipe({ db: db(), recipeId: id, curatorId: userId })
    expect(res.kind).toBe('ok')

    expect(await statusOf(id)).toBe('approved')
    // HONESTIDADE (dec.5): pt-BR (original) promovido; en-US permanece automatica_nao_revisada.
    expect(await provOf(id, 'pt-BR')).toBe('automatica_revisada')
    expect(await provOf(id, 'en-US')).toBe('automatica_nao_revisada')
    const [r] = await db().select({ at: recipe.reviewedAt, by: recipe.reviewedBy }).from(recipe).where(eq(recipe.id, id))
    expect(r.at).not.toBeNull()
    expect(r.by).toBe(userId)

    // depois: público (GET-uuid 200)
    const after = await recipeGet(new Request(`http://localhost/api/recipes/${id}`), { params: Promise.resolve({ id }) })
    expect(after.status).toBe(200)
  })

  it('aprovar de novo ⇒ invalid_state (já aprovado)', async () => {
    const { userId } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com` })
    const id = await seedBilingualPending(`appr2${Date.now().toString(36)}`)
    await approveCatalogRecipe({ db: db(), recipeId: id, curatorId: userId })
    const again = await approveCatalogRecipe({ db: db(), recipeId: id, curatorId: userId })
    expect(again.kind).toBe('invalid_state')
  })

  it('receita de USUÁRIO (owner-not-null) ⇒ not_found (não-catálogo não é curável)', async () => {
    const { userId } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com` })
    const userRecipe = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: userId, visibility: 'public' })
    const res = await approveCatalogRecipe({ db: db(), recipeId: userRecipe, curatorId: userId })
    expect(res.kind).toBe('not_found')
  })
})

describe('rejectCatalogRecipe — tombstone', () => {
  it('pending→rejected com nota; fora da fila ativa; aparece em rejeitadas', async () => {
    const { userId } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com` })
    const id = await seedBilingualPending(`rej${Date.now().toString(36)}`)

    const res = await rejectCatalogRecipe({ db: db(), recipeId: id, curatorId: userId, note: 'duplicata' })
    expect(res.kind).toBe('ok')
    expect(await statusOf(id)).toBe('rejected')

    const queue = await listCatalogCurationQueue(db())
    expect(queue.some((q) => q.recipeId === id)).toBe(false)
    const rejected = await listRejectedCatalog(db())
    const mine = rejected.find((q) => q.recipeId === id)
    expect(mine).toBeDefined()
    expect(mine!.reviewNote).toBe('duplicata')

    // ainda escondido do público
    const get = await recipeGet(new Request(`http://localhost/api/recipes/${id}`), { params: Promise.resolve({ id }) })
    expect(get.status).toBe(404)
  })
})

describe('editing + unreject + fila', () => {
  it('pending→editing (idempotente) e segue na fila ativa', async () => {
    const id = await seedBilingualPending(`edit${Date.now().toString(36)}`)
    expect((await startEditingCatalogRecipe({ db: db(), recipeId: id })).kind).toBe('ok')
    expect(await statusOf(id)).toBe('editing')
    expect((await startEditingCatalogRecipe({ db: db(), recipeId: id })).kind).toBe('ok') // idempotente
    const queue = await listCatalogCurationQueue(db())
    expect(queue.some((q) => q.recipeId === id)).toBe(true)
  })

  it('rejected→pending (des-rejeitar) limpa reviewed e volta à fila', async () => {
    const { userId } = await seedSessionHeaders({ email: `cur-${crypto.randomUUID()}@ex.com` })
    const id = await seedBilingualPending(`unrej${Date.now().toString(36)}`)
    await rejectCatalogRecipe({ db: db(), recipeId: id, curatorId: userId, note: 'x' })
    expect((await unrejectCatalogRecipe({ db: db(), recipeId: id })).kind).toBe('ok')
    expect(await statusOf(id)).toBe('pending')
    const [r] = await db().select({ at: recipe.reviewedAt, by: recipe.reviewedBy, note: recipe.reviewNote }).from(recipe).where(eq(recipe.id, id))
    expect(r.at).toBeNull()
    expect(r.by).toBeNull()
    expect(r.note).toBeNull()
  })
})
