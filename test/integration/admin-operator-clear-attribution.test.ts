import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/admin/attribution/clear/route'
import { getDb } from '@/server/deps'
import { recipe, dsarAuditEvent } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Atendimento ao autor externo (titular B) pelo operador — #396/GAP-4 (`docs/legal/
 * takedown-e-remocao-titular.md` §4.2), pela porta MAIS ALTA (POST /api/admin/attribution/clear).
 * ADMIN-ONLY (Curador/Usuário → 403, anon → 401). Zera `source_name` em LOTE por nome/URL SEM
 * ownership (inclui privadas de outros usuários); MESMA regra (`hasRemovableSourceName`); `source_url`
 * NUNCA tocado; idempotente; grava 1 DSAR_FULFILLED (channel 'operator') na mesma transação.
 */

const NAME = 'Cozinha da Vovó'
const URL_A = 'https://exemplo.com/receitas/bolo'

function withJson(headers?: Headers): Headers {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return h
}

function clearPost(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/attribution/clear', {
      method: 'POST',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
  )
}

/** Importada de `ownerId` (pode ser null = catálogo) com atribuição — seedRecipe não tem esses campos. */
async function seedImported(input: {
  ownerId: string | null
  sourceName: string | null
  sourceUrl: string | null
  origin?: 'web_imported' | 'ai_structured'
}): Promise<string> {
  const id = await seedRecipe({
    origin: input.origin ?? 'web_imported',
    originalLocale: 'pt-BR',
    visibility: 'private',
    ownerId: input.ownerId,
  })
  await getDb()
    .update(recipe)
    .set({ sourceUrl: input.sourceUrl, sourceName: input.sourceName })
    .where(eq(recipe.id, id))
  await seedTranslation({
    recipeId: id,
    locale: 'pt-BR',
    titulo: 'Bolo Importado',
    provenance: 'automatica_nao_revisada',
    slug: `bolo-${id.slice(0, 8)}`,
  })
  return id
}

async function loadSource(id: string) {
  const [row] = await getDb()
    .select({
      origin: recipe.origin,
      sourceName: recipe.sourceName,
      sourceUrl: recipe.sourceUrl,
      updatedAt: recipe.updatedAt,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row
}

async function loadDsarEventsByActor(actorId: string) {
  return getDb()
    .select({
      eventType: dsarAuditEvent.eventType,
      channel: dsarAuditEvent.channel,
      requestType: dsarAuditEvent.requestType,
      payloadHash: dsarAuditEvent.payloadHash,
      caseId: dsarAuditEvent.caseId,
      details: dsarAuditEvent.details,
    })
    .from(dsarAuditEvent)
    .where(eq(dsarAuditEvent.actorId, actorId))
}

describe('POST /api/admin/attribution/clear (#396 GAP-4) — gate de papel', () => {
  it('anon (sem sessão) → 401, zero efeito', async () => {
    const owner = await seedSessionHeaders({ email: 'op-anon-owner@ex.com' })
    const id = await seedImported({ ownerId: owner.userId, sourceName: NAME, sourceUrl: URL_A })

    const res = await clearPost({ sourceName: NAME, apply: true })
    expect(res.status).toBe(401)
    expect((await loadSource(id)).sourceName).toBe(NAME)
  })

  it('usuario comum → 403; curador → 403 (admin-only)', async () => {
    const u = await seedSessionHeaders({ email: 'op-usuario@ex.com', role: 'usuario' })
    const c = await seedSessionHeaders({ email: 'op-curador@ex.com', role: 'curador' })
    expect((await clearPost({ sourceName: NAME, apply: true }, u.headers)).status).toBe(403)
    expect((await clearPost({ sourceName: NAME, apply: true }, c.headers)).status).toBe(403)
  })
})

describe('POST /api/admin/attribution/clear (#396 GAP-4) — validação', () => {
  it('sem critério (nem nome nem url) → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'op-nocrit@ex.com', role: 'admin' })
    const res = await clearPost({ apply: true }, headers)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('criterio_obrigatorio')
  })

  it('caseId não-uuid → 400 (não estoura o driver)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'op-badcase@ex.com', role: 'admin' })
    const res = await clearPost({ sourceName: NAME, caseId: 'nao-uuid', apply: true }, headers)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('case_id_invalido')
  })
})

describe('POST /api/admin/attribution/clear (#396 GAP-4) — comportamento', () => {
  it('prévia (apply omitido) casa por nome em receitas de OUTROS donos, SEM mutar nem auditar', async () => {
    const admin = await seedSessionHeaders({ email: 'op-preview@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-alice@ex.com' })
    const bob = await seedSessionHeaders({ email: 'op-bob@ex.com' })
    const rA = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rB = await seedImported({
      ownerId: bob.userId,
      sourceName: NAME,
      sourceUrl: 'https://outro.com/x',
    })

    const res = await clearPost({ sourceName: NAME }, admin.headers) // apply omitido = prévia
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      applied: boolean
      matched: number
      recipeIds: string[]
      distinctSourceNames: string[]
    }
    expect(body.applied).toBe(false)
    expect(body.matched).toBe(2)
    expect(new Set(body.recipeIds)).toEqual(new Set([rA, rB]))
    // A prévia expõe os nomes DISTINTOS que seriam zerados (ambas as receitas têm o mesmo nome).
    expect(body.distinctSourceNames).toEqual([NAME])

    // Prévia NÃO muta nem audita.
    expect((await loadSource(rA)).sourceName).toBe(NAME)
    expect((await loadSource(rB)).sourceName).toBe(NAME)
    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(0)
  })

  it('prévia com nome+url: o ramo de URL arrasta outro import da MESMA url com nome DIFERENTE → expõe os dois nomes', async () => {
    const admin = await seedSessionHeaders({ email: 'op-scope@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-scope-alice@ex.com' })
    const bob = await seedSessionHeaders({ email: 'op-scope-bob@ex.com' })
    // Mesma URL, nomes diferentes (site trocou de marca entre imports).
    const rPedido = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rArrastado = await seedImported({
      ownerId: bob.userId,
      sourceName: 'Marca Nova',
      sourceUrl: URL_A,
    })

    // Operador preenche nome E url: o ramo de URL casa rArrastado, cujo nome NÃO foi pedido.
    const res = await clearPost({ sourceName: NAME, sourceUrl: URL_A }, admin.headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      applied: boolean
      matched: number
      recipeIds: string[]
      distinctSourceNames: string[]
    }
    expect(new Set(body.recipeIds)).toEqual(new Set([rPedido, rArrastado]))
    // A prévia lista AMBOS os nomes (ordenados) — 'Marca Nova' fica visível antes de aplicar.
    expect(body.distinctSourceNames).toEqual(['Cozinha da Vovó', 'Marca Nova'])
    // Continua sem mutar.
    expect((await loadSource(rArrastado)).sourceName).toBe('Marca Nova')
  })

  it('remove por nome em lote (privadas de OUTROS donos); url + origin preservados; 1 DSAR_FULFILLED com hash', async () => {
    const admin = await seedSessionHeaders({ email: 'op-apply@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-apply-alice@ex.com' })
    const bob = await seedSessionHeaders({ email: 'op-apply-bob@ex.com' })
    const rA = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rB = await seedImported({
      ownerId: bob.userId,
      sourceName: NAME,
      sourceUrl: 'https://outro.com/x',
    })
    // Uma receita com nome DIFERENTE não deve ser tocada.
    const rOther = await seedImported({
      ownerId: alice.userId,
      sourceName: 'Outro Chef',
      sourceUrl: 'https://z.com/y',
    })

    const res = await clearPost({ sourceName: NAME, apply: true }, admin.headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: boolean; matched: number; recipeIds: string[] }
    expect(body.applied).toBe(true)
    expect(new Set(body.recipeIds)).toEqual(new Set([rA, rB]))

    for (const id of [rA, rB]) {
      const row = await loadSource(id)
      expect(row.sourceName).toBeNull() // nome zerado
      expect(row.origin).toBe('web_imported') // origin intacto
    }
    expect((await loadSource(rA)).sourceUrl).toBe(URL_A) // URL PRESERVADA
    expect((await loadSource(rOther)).sourceName).toBe('Outro Chef') // nome diferente: intacto

    const events = await loadDsarEventsByActor(admin.userId)
    expect(events).toHaveLength(1)
    const [ev] = events
    expect(ev.eventType).toBe('DSAR_FULFILLED')
    expect(ev.channel).toBe('operator')
    expect(ev.requestType).toBe('name_removal')
    expect(ev.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(ev.details).toEqual({ recipeIds: expect.arrayContaining([rA, rB]) })
    // MINIMIZAÇÃO: o nome removido não aparece em claro em NENHUM campo do registro.
    expect(JSON.stringify(ev)).not.toContain(NAME)
  })

  it('casa por URL exata; nome que JÁ é o host é no-op (não conta como removível)', async () => {
    const admin = await seedSessionHeaders({ email: 'op-url@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-url-alice@ex.com' })
    const rHuman = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rHost = await seedImported({
      ownerId: alice.userId,
      sourceName: 'www.exemplo.com',
      sourceUrl: 'https://www.exemplo.com/r',
    })

    // Prévia por URL exata do host-name: casa 1 mas 0 removível (nome == host).
    const prev = (await (
      await clearPost({ sourceUrl: 'https://www.exemplo.com/r' }, admin.headers)
    ).json()) as { matched: number; recipeIds: string[] }
    expect(prev.matched).toBe(1)
    expect(prev.recipeIds).toHaveLength(0)

    // Aplica por URL exata do nome humano: remove só esse.
    const res = (await (
      await clearPost({ sourceUrl: URL_A, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(res.recipeIds).toEqual([rHuman])
    expect((await loadSource(rHuman)).sourceName).toBeNull()
    expect((await loadSource(rHost)).sourceName).toBe('www.exemplo.com') // no-op intacto
  })

  it('idempotente: 2ª aplicação com o mesmo critério → 0 removíveis, sem novo evento', async () => {
    const admin = await seedSessionHeaders({ email: 'op-idem@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-idem-alice@ex.com' })
    await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })

    const first = (await (await clearPost({ sourceName: NAME, apply: true }, admin.headers)).json()) as {
      recipeIds: string[]
    }
    expect(first.recipeIds).toHaveLength(1)

    const second = (await (
      await clearPost({ sourceName: NAME, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(second.recipeIds).toHaveLength(0) // nome já zerado

    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(1) // só a 1ª auditou
  })

  it('caseId uuid válido é gravado no evento', async () => {
    const admin = await seedSessionHeaders({ email: 'op-case@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'op-case-alice@ex.com' })
    await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const caseId = crypto.randomUUID()

    await clearPost({ sourceName: NAME, caseId, apply: true }, admin.headers)
    const [ev] = await loadDsarEventsByActor(admin.userId)
    expect(ev.caseId).toBe(caseId)
  })
})
