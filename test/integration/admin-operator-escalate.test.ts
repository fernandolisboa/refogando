import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { POST } from '@/app/api/admin/attribution/escalate/route'
import { getDb } from '@/server/deps'
import { recipe, dsarAuditEvent } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * ESCALADA além do nome (titular B) pelo operador — #397/GAP-3 (`docs/legal/
 * takedown-e-remocao-titular.md` §4.1), pela porta MAIS ALTA (POST /api/admin/attribution/escalate).
 * ADMIN-ONLY (Curador/Usuário → 403, anon → 401). Duas ações: `url_unlink` (zera source_url E
 * source_name) e `record_deletion` (apaga a importada). Por nome/URL, SEM ownership (privadas de
 * outros); idempotente; prévia mostra escopo (nomes + URLs); grava 1 DSAR_FULFILLED (channel 'operator',
 * requestType distinto) na mesma transação; o nome/URL removidos NUNCA aparecem em claro.
 */

const NAME = 'Cozinha da Vovó'
const URL_A = 'https://exemplo.com/receitas/bolo'

function withJson(headers?: Headers): Headers {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return h
}

function escalatePost(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/attribution/escalate', {
      method: 'POST',
      headers: withJson(headers),
      body: JSON.stringify(body),
    }),
  )
}

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
      id: recipe.id,
      origin: recipe.origin,
      sourceName: recipe.sourceName,
      sourceUrl: recipe.sourceUrl,
    })
    .from(recipe)
    .where(eq(recipe.id, id))
  return row // undefined se apagada
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

describe('POST /api/admin/attribution/escalate (#397 GAP-3) — gate de papel', () => {
  it('anon (sem sessão) → 401, zero efeito', async () => {
    const owner = await seedSessionHeaders({ email: 'esc-anon-owner@ex.com' })
    const id = await seedImported({ ownerId: owner.userId, sourceName: NAME, sourceUrl: URL_A })

    const res = await escalatePost({ action: 'record_deletion', sourceName: NAME, apply: true })
    expect(res.status).toBe(401)
    expect(await loadSource(id)).toBeDefined() // não apagada
  })

  it('usuario comum → 403; curador → 403 (admin-only)', async () => {
    const u = await seedSessionHeaders({ email: 'esc-usuario@ex.com', role: 'usuario' })
    const c = await seedSessionHeaders({ email: 'esc-curador@ex.com', role: 'curador' })
    const body = { action: 'url_unlink', sourceName: NAME, apply: true }
    expect((await escalatePost(body, u.headers)).status).toBe(403)
    expect((await escalatePost(body, c.headers)).status).toBe(403)
  })
})

describe('POST /api/admin/attribution/escalate (#397 GAP-3) — validação', () => {
  it('ação ausente/inválida → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'esc-noacao@ex.com', role: 'admin' })
    const semAcao = await escalatePost({ sourceName: NAME, apply: true }, headers)
    expect(semAcao.status).toBe(400)
    expect(((await semAcao.json()) as { error: string }).error).toBe('acao_invalida')

    const acaoRuim = await escalatePost({ action: 'nuke', sourceName: NAME }, headers)
    expect(acaoRuim.status).toBe(400)
  })

  it('sem critério (nem nome nem url) → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'esc-nocrit@ex.com', role: 'admin' })
    const res = await escalatePost({ action: 'url_unlink', apply: true }, headers)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('criterio_obrigatorio')
  })

  it('caseId não-uuid → 400 (não estoura o driver)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'esc-badcase@ex.com', role: 'admin' })
    const res = await escalatePost(
      { action: 'url_unlink', sourceName: NAME, caseId: 'nao-uuid', apply: true },
      headers,
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('case_id_invalido')
  })
})

describe('POST /api/admin/attribution/escalate (#397 GAP-3) — url_unlink', () => {
  it('prévia (apply omitido) por nome: casa em OUTROS donos, expõe nomes+URLs, SEM mutar nem auditar', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-u-prev@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-u-prev-a@ex.com' })
    const rA = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })

    const res = await escalatePost({ action: 'url_unlink', sourceName: NAME }, admin.headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      applied: boolean
      action: string
      matched: number
      recipeIds: string[]
      distinctSourceNames: string[]
      distinctSourceUrls: string[]
    }
    expect(body.applied).toBe(false)
    expect(body.action).toBe('url_unlink')
    expect(body.recipeIds).toEqual([rA])
    expect(body.distinctSourceNames).toEqual([NAME])
    expect(body.distinctSourceUrls).toEqual([URL_A])

    // Prévia NÃO muta nem audita.
    const row = await loadSource(rA)
    expect(row.sourceName).toBe(NAME)
    expect(row.sourceUrl).toBe(URL_A)
    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(0)
  })

  it('desvincula: zera source_url E source_name (mantém origin); 1 DSAR_FULFILLED requestType url_unlink; sem dado em claro', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-u-apply@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-u-apply-a@ex.com' })
    const bob = await seedSessionHeaders({ email: 'esc-u-apply-b@ex.com' })
    const rA = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rB = await seedImported({
      ownerId: bob.userId,
      sourceName: NAME,
      sourceUrl: 'https://outro.com/x',
    })
    const rOther = await seedImported({
      ownerId: alice.userId,
      sourceName: 'Outro Chef',
      sourceUrl: 'https://z.com/y',
    })

    const res = await escalatePost(
      { action: 'url_unlink', sourceName: NAME, apply: true },
      admin.headers,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: boolean; recipeIds: string[] }
    expect(body.applied).toBe(true)
    expect(new Set(body.recipeIds)).toEqual(new Set([rA, rB]))

    for (const id of [rA, rB]) {
      const row = await loadSource(id)
      expect(row.sourceName).toBeNull() // nome zerado
      expect(row.sourceUrl).toBeNull() // URL zerada (a atribuição some por completo)
      expect(row.origin).toBe('web_imported') // origin intacto
    }
    expect((await loadSource(rOther)).sourceName).toBe('Outro Chef') // fora do critério: intacto

    const events = await loadDsarEventsByActor(admin.userId)
    expect(events).toHaveLength(1)
    const [ev] = events
    expect(ev.eventType).toBe('DSAR_FULFILLED')
    expect(ev.channel).toBe('operator')
    expect(ev.requestType).toBe('url_unlink')
    expect(ev.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(ev.details).toEqual({
      recipeIds: expect.arrayContaining([rA, rB]),
      action: 'url_unlink',
    })
    // MINIMIZAÇÃO: nem o nome nem a URL removidos aparecem em claro em NENHUM campo.
    expect(JSON.stringify(ev)).not.toContain(NAME)
    expect(JSON.stringify(ev)).not.toContain(URL_A)
  })

  it('idempotente: 2ª desvinculação com o mesmo critério → 0 afetados, sem novo evento', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-u-idem@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-u-idem-a@ex.com' })
    await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })

    const first = (await (
      await escalatePost({ action: 'url_unlink', sourceName: NAME, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(first.recipeIds).toHaveLength(1)

    const second = (await (
      await escalatePost({ action: 'url_unlink', sourceName: NAME, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(second.recipeIds).toHaveLength(0) // nome/URL já zerados ⇒ não casa mais

    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(1)
  })
})

describe('POST /api/admin/attribution/escalate (#397 GAP-3) — record_deletion', () => {
  it('apaga a importada por URL exata; 1 DSAR_FULFILLED requestType record_deletion; sem dado em claro', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-d-apply@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-d-apply-a@ex.com' })
    const rDel = await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })
    const rKeep = await seedImported({
      ownerId: alice.userId,
      sourceName: 'Outro',
      sourceUrl: 'https://z.com/y',
    })

    const res = await escalatePost(
      { action: 'record_deletion', sourceUrl: URL_A, apply: true },
      admin.headers,
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { applied: boolean; recipeIds: string[] }
    expect(body.applied).toBe(true)
    expect(body.recipeIds).toEqual([rDel])

    expect(await loadSource(rDel)).toBeUndefined() // receita APAGADA
    expect(await loadSource(rKeep)).toBeDefined() // fora do critério: sobrevive

    const events = await loadDsarEventsByActor(admin.userId)
    expect(events).toHaveLength(1)
    const [ev] = events
    expect(ev.requestType).toBe('record_deletion')
    expect(ev.payloadHash).toMatch(/^[0-9a-f]{64}$/)
    expect(ev.details).toEqual({ recipeIds: [rDel], action: 'record_deletion' })
    expect(JSON.stringify(ev)).not.toContain(NAME)
    expect(JSON.stringify(ev)).not.toContain(URL_A)
  })

  it('idempotente: 2ª deleção com o mesmo critério → 0 afetados, sem novo evento', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-d-idem@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-d-idem-a@ex.com' })
    await seedImported({ ownerId: alice.userId, sourceName: NAME, sourceUrl: URL_A })

    const first = (await (
      await escalatePost({ action: 'record_deletion', sourceUrl: URL_A, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(first.recipeIds).toHaveLength(1)

    const second = (await (
      await escalatePost({ action: 'record_deletion', sourceUrl: URL_A, apply: true }, admin.headers)
    ).json()) as { recipeIds: string[] }
    expect(second.recipeIds).toHaveLength(0)

    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(1)
  })

  it('NÃO apaga receita não-importada (origin ≠ web_imported) mesmo casando o nome', async () => {
    const admin = await seedSessionHeaders({ email: 'esc-d-origin@ex.com', role: 'admin' })
    const alice = await seedSessionHeaders({ email: 'esc-d-origin-a@ex.com' })
    // Mesma "URL/nome" mas origin ai_structured — não é importada, fora do alvo da escalada.
    const rAi = await seedImported({
      ownerId: alice.userId,
      sourceName: NAME,
      sourceUrl: URL_A,
      origin: 'ai_structured',
    })

    const res = await escalatePost(
      { action: 'record_deletion', sourceName: NAME, apply: true },
      admin.headers,
    )
    const body = (await res.json()) as { recipeIds: string[] }
    expect(body.recipeIds).toHaveLength(0)
    expect(await loadSource(rAi)).toBeDefined() // intacta
    expect(await loadDsarEventsByActor(admin.userId)).toHaveLength(0)
  })
})
