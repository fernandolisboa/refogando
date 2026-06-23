import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST as restrictRoute } from '@/app/api/curate/users/[id]/image-gen-restriction/route'
import { POST as generateRoute } from '@/app/api/recipes/[id]/image/generate/route'
import { getDb, setImageStore, setImageGenerator } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { users } from '@/db/schema'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders, seedUser } from '../helpers/users'

/**
 * Restrição de conta (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007) — `POST
 * /api/curate/users/[id]/image-gen-restriction`. O Curador BLOQUEIA/DESBLOQUEIA a geração-de-
 * imagem-por-IA de um Usuário (abuso confirmado). Prova ponta-a-ponta: bloquear grava a
 * proveniência (at/by/reason) E faz o generate do alvo virar 403; desbloquear zera E o generate
 * volta a 200. Gating: `usuario` (não-curador) → 403 (requireRole fail-closed); motivo vazio → 400;
 * alvo inexistente → 404. FakeImageStore/Generator (NUNCA tocam Gemini/Blob).
 */

let store: FakeImageStore
let gen: FakeImageGenerator
beforeEach(() => {
  store = new FakeImageStore()
  gen = new FakeImageGenerator()
  setImageStore(store)
  setImageGenerator(gen)
})

const restrictCtx = (id: string) => ({ params: Promise.resolve({ id }) })
const genCtx = (id: string) => ({ params: Promise.resolve({ id }) })

function restrictReq(targetId: string, body: unknown, headers?: Headers): Request {
  return new Request(`http://localhost/api/curate/users/${targetId}/image-gen-restriction`, {
    method: 'POST',
    headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function genReq(id: string, headers?: Headers): Request {
  return new Request(`http://localhost/api/recipes/${id}/image/generate`, {
    method: 'POST',
    headers: { ...(headers ? Object.fromEntries(headers) : {}), 'content-type': 'application/json' },
  })
}

/** Receita ai própria com título + 1 ingrediente (insumo do prompt). */
async function seedOwned(ownerId: string): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo de fubá', provenance: 'automatica_nao_revisada' })
  await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'fubá', quantidade: null })
  return id
}

async function blockRow(userId: string): Promise<{
  at: Date | null
  by: string | null
  reason: string | null
}> {
  const [r] = await getDb()
    .select({
      at: users.imageGenBlockedAt,
      by: users.imageGenBlockedBy,
      reason: users.imageGenBlockedReason,
    })
    .from(users)
    .where(eq(users.id, userId))
  return r ?? { at: null, by: null, reason: null }
}

describe('POST /api/curate/users/[id]/image-gen-restriction (#226)', () => {
  it('curador bloqueia → grava at/by/reason; o generate do alvo passa a 403 geracao_bloqueada', async () => {
    const curatorHeaders = (await seedSessionHeaders({ email: 'cur@r.test', role: 'curador' })).headers
    const curatorId = (await getDb().select({ id: users.id }).from(users).where(eq(users.email, 'cur@r.test')))[0].id
    const { userId, headers } = await seedSessionHeaders({ email: 'alvo@r.test' })
    const id = await seedOwned(userId)

    // Antes: o alvo gera normalmente.
    expect((await generateRoute(genReq(id, headers), genCtx(id))).status).toBe(200)

    // Curador bloqueia.
    const res = await restrictRoute(
      restrictReq(userId, { blocked: true, reason: 'gerou imagem abusiva' }, curatorHeaders),
      restrictCtx(userId),
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ ok: true })

    // DB: a proveniência foi gravada (by = o curador, reason não-vazio, at setado).
    const row = await blockRow(userId)
    expect(row.at).not.toBeNull()
    expect(row.by).toBe(curatorId)
    expect(row.reason).toBe('gerou imagem abusiva')

    // Agora o generate do alvo vira 403 geracao_bloqueada.
    const blocked = await generateRoute(genReq(id, headers), genCtx(id))
    expect(blocked.status).toBe(403)
    await expect(blocked.json()).resolves.toMatchObject({ error: 'geracao_bloqueada' })
  })

  it('curador desbloqueia → zera at/by/reason; o generate do alvo volta a 200', async () => {
    const curatorHeaders = (await seedSessionHeaders({ email: 'cur2@r.test', role: 'curador' })).headers
    const { userId, headers } = await seedSessionHeaders({ email: 'alvo2@r.test' })
    const id = await seedOwned(userId)

    // Bloqueia primeiro.
    expect(
      (await restrictRoute(restrictReq(userId, { blocked: true, reason: 'abuso' }, curatorHeaders), restrictCtx(userId))).status,
    ).toBe(200)
    expect((await generateRoute(genReq(id, headers), genCtx(id))).status).toBe(403)

    // Desbloqueia (sem motivo).
    const res = await restrictRoute(restrictReq(userId, { blocked: false }, curatorHeaders), restrictCtx(userId))
    expect(res.status).toBe(200)

    // DB: as 3 colunas zeradas.
    const row = await blockRow(userId)
    expect(row.at).toBeNull()
    expect(row.by).toBeNull()
    expect(row.reason).toBeNull()

    // O generate volta a funcionar.
    expect((await generateRoute(genReq(id, headers), genCtx(id))).status).toBe(200)
  })

  it('não-curador (usuario) → 403 (requireRole fail-closed); nada gravado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ze@r.test' }) // role usuario
    const target = await seedUser({ email: 'vitima@r.test' })

    const res = await restrictRoute(restrictReq(target, { blocked: true, reason: 'x' }, headers), restrictCtx(target))
    expect(res.status).toBe(403)
    expect((await blockRow(target)).at).toBeNull() // nada gravado
  })

  it('anônimo (sem sessão) → 401', async () => {
    const target = await seedUser({ email: 'vitima2@r.test' })
    const res = await restrictRoute(restrictReq(target, { blocked: true, reason: 'x' }), restrictCtx(target))
    expect(res.status).toBe(401)
  })

  it('bloquear com motivo VAZIO → 400 dados_invalidos; nada gravado', async () => {
    const curatorHeaders = (await seedSessionHeaders({ email: 'cur3@r.test', role: 'curador' })).headers
    const target = await seedUser({ email: 'alvo3@r.test' })

    const res = await restrictRoute(restrictReq(target, { blocked: true, reason: '   ' }, curatorHeaders), restrictCtx(target))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    expect((await blockRow(target)).at).toBeNull()
  })

  it('alvo inexistente (uuid válido, sem linha) → 404 not_found', async () => {
    const curatorHeaders = (await seedSessionHeaders({ email: 'cur4@r.test', role: 'curador' })).headers
    const ghost = '00000000-0000-0000-0000-0000000000ff'

    const res = await restrictRoute(restrictReq(ghost, { blocked: true, reason: 'x' }, curatorHeaders), restrictCtx(ghost))
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('uuid inválido no path → 404 (antes do guard)', async () => {
    const res = await restrictRoute(restrictReq('not-a-uuid', { blocked: true, reason: 'x' }), restrictCtx('not-a-uuid'))
    expect(res.status).toBe(404)
  })

  it('re-bloquear preserva a 1ª proveniência (ok_already_blocked) → 200; by/reason inalterados', async () => {
    const c1 = (await seedSessionHeaders({ email: 'cur5@r.test', role: 'curador' })).headers
    const c2 = (await seedSessionHeaders({ email: 'cur6@r.test', role: 'curador' })).headers
    const c1Id = (await getDb().select({ id: users.id }).from(users).where(eq(users.email, 'cur5@r.test')))[0].id
    const target = await seedUser({ email: 'alvo5@r.test' })

    expect((await restrictRoute(restrictReq(target, { blocked: true, reason: 'primeira' }, c1), restrictCtx(target))).status).toBe(200)
    // 2º curador re-bloqueia: 200, mas a proveniência da 1ª é preservada (by=c1, reason='primeira').
    expect((await restrictRoute(restrictReq(target, { blocked: true, reason: 'segunda' }, c2), restrictCtx(target))).status).toBe(200)

    const row = await blockRow(target)
    expect(row.by).toBe(c1Id)
    expect(row.reason).toBe('primeira')
  })
})
