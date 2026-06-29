import { beforeEach, describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { recipe } from '@/db/schema'
import { GET as queueGet } from '@/app/api/curate/recipes/queue/route'
import { POST as approveRoute } from '@/app/api/curate/recipes/[id]/approve/route'
import { POST as rejectRoute } from '@/app/api/curate/recipes/[id]/reject/route'
import { POST as editingRoute } from '@/app/api/curate/recipes/[id]/editing/route'
import { POST as unrejectRoute } from '@/app/api/curate/recipes/[id]/unreject/route'
import { GET as draftGet } from '@/app/api/curate/recipes/[id]/route'
import { seedRecipe, seedTranslation } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Auth-gating das ROTAS de curadoria de catálogo (#238, ADR-0026) — o code-review apontou que as
 * ações eram testadas só via função de servidor, deixando `requireRole('curador')` sem cobertura (e
 * o repo tem gotcha de requireRole fail-open). Aqui exercitamos os HANDLERS: Visitante→401,
 * usuario→403, curador→200/ação; uuid inválido→404; estado incompatível→409.
 */

const db = () => getDb()

// #238 (code-review H3): a rota de APROVAR agora injeta store/generator (auto-gen na aprovação). Sem
// Fakes, `resetDeps` daria os seams REAIS (Gemini/Blob) → chamada de rede paga a cada aprovação. Os
// Fakes mantêm a aprovação determinística e offline.
beforeEach(() => {
  setImageStore(new FakeImageStore())
  setImageGenerator(new FakeImageGenerator())
})

async function pendingDraft(): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, curationStatus: 'pending' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Rascunho', provenance: 'automatica_nao_revisada' })
  return id
}
function post(handler: typeof approveRoute, id: string, headers?: Headers, body = '{}'): Promise<Response> {
  return handler(new Request(`http://localhost/api/curate/recipes/${id}/x`, { method: 'POST', headers, body }), {
    params: Promise.resolve({ id }),
  })
}

describe('rotas de curadoria — papel', () => {
  it('GET /queue: Visitante→401, usuario→403, curador→200', async () => {
    expect((await queueGet(new Request('http://localhost/api/curate/recipes/queue'))).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com` })
    expect((await queueGet(new Request('http://localhost/api/curate/recipes/queue', { headers: u }))).status).toBe(403)
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await queueGet(new Request('http://localhost/api/curate/recipes/queue', { headers: c }))).status).toBe(200)
  })

  it('POST /approve: Visitante→401, usuario→403 (sem efeito); curador→200', async () => {
    const id = await pendingDraft()
    expect((await post(approveRoute, id)).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com` })
    expect((await post(approveRoute, id, u)).status).toBe(403)
    // não mexeu no estado
    const [mid] = await db().select({ s: recipe.curationStatus }).from(recipe).where(eq(recipe.id, id))
    expect(mid.s).toBe('pending')
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await post(approveRoute, id, c)).status).toBe(200)
  })

  it('GET /[id] (corpo do rascunho): Visitante→401, usuario→403, curador→200', async () => {
    const id = await pendingDraft()
    const getDraft = (headers?: Headers) =>
      draftGet(new Request(`http://localhost/api/curate/recipes/${id}`, { headers }), { params: Promise.resolve({ id }) })
    expect((await getDraft()).status).toBe(401)
    const { headers: u } = await seedSessionHeaders({ email: `u-${crypto.randomUUID()}@ex.com` })
    expect((await getDraft(u)).status).toBe(403)
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await getDraft(c)).status).toBe(200)
  })

  it('curador: uuid inválido→404; aprovar já-aprovado→409; rejeitar persiste a nota; editing/unreject', async () => {
    const { headers: c } = await seedSessionHeaders({ email: `c-${crypto.randomUUID()}@ex.com`, role: 'curador' })
    expect((await post(approveRoute, 'nao-eh-uuid', c)).status).toBe(404)

    const id = await pendingDraft()
    expect((await post(editingRoute, id, c)).status).toBe(200) // pending→editing
    expect((await post(approveRoute, id, c)).status).toBe(200) // editing→approved
    expect((await post(approveRoute, id, c)).status).toBe(409) // já aprovado

    const rid = await pendingDraft()
    expect((await post(rejectRoute, rid, c, JSON.stringify({ note: 'duplicata' }))).status).toBe(200)
    const [r] = await db().select({ note: recipe.reviewNote, s: recipe.curationStatus }).from(recipe).where(eq(recipe.id, rid))
    expect(r.s).toBe('rejected')
    expect(r.note).toBe('duplicata')
    expect((await post(unrejectRoute, rid, c)).status).toBe(200) // rejected→pending
  })
})
