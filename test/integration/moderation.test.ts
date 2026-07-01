import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipe, report, recipeTranslation, recipeEmbedding, recipeSave } from '@/db/schema'
import { POST as reportRoute } from '@/app/api/recipes/[id]/report/route'
import { GET as reportsQueueRoute } from '@/app/api/curate/reports/route'
import { POST as removeRoute } from '@/app/api/curate/reports/[id]/remove/route'
import { POST as keepRoute } from '@/app/api/curate/reports/[id]/keep/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { GET as searchRoute } from '@/app/api/search/route'
import { POST as saveRoute } from '@/app/api/recipes/[id]/save/route'
import { POST as publishRoute } from '@/app/api/recipes/[id]/publish/route'
import { POST as unpublishRoute } from '@/app/api/recipes/[id]/unpublish/route'
import { POST as translateRoute } from '@/app/api/recipes/[id]/translations/[locale]/route'
import { GET as adminConfigGet, PUT as adminConfigPut } from '@/app/api/admin/config/route'
import { seedSessionHeaders, seedDeletedSessionHeaders } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedReport,
  seedRemovedFromPool,
  seedSave,
} from '../helpers/recipes'

/**
 * Moderação reativa: Report + remover-do-pool pelo Curador (issue #18, ADR-0003/0011).
 * Pela porta mais alta (route handlers + Postgres descartável). Modelo de invocação:
 * recipes-social.test.ts (Request cru + params Promise; headers de sessão por papel).
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function reportRecipe(id: string, body: unknown, headers?: Headers): Promise<Response> {
  return reportRoute(
    new Request(`http://localhost/api/recipes/${id}/report`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}
function reportsQueue(headers?: Headers): Promise<Response> {
  return reportsQueueRoute(new Request('http://localhost/api/curate/reports', { headers }))
}
function remove(reportId: string, body: unknown, headers?: Headers): Promise<Response> {
  return removeRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/remove`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
function keep(reportId: string, headers?: Headers): Promise<Response> {
  return keepRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/keep`, { method: 'POST', headers }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
function get(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function search(qs: string): Promise<Response> {
  return searchRoute(new Request(`http://localhost/api/search?${qs}`))
}
function save(id: string, headers?: Headers): Promise<Response> {
  return saveRoute(new Request(`http://localhost/api/recipes/${id}/save`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function publish(id: string, headers?: Headers): Promise<Response> {
  return publishRoute(new Request(`http://localhost/api/recipes/${id}/publish`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function unpublish(id: string, headers?: Headers): Promise<Response> {
  return unpublishRoute(new Request(`http://localhost/api/recipes/${id}/unpublish`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
function translate(id: string, locale: string, headers?: Headers): Promise<Response> {
  return translateRoute(
    new Request(`http://localhost/api/recipes/${id}/translations/${locale}`, { method: 'POST', headers }),
    { params: Promise.resolve({ id, locale }) },
  )
}

// ── Seeds compostos ─────────────────────────────────────────────────────────────
/** Comunidade PÚBLICA com dono + título buscável; pt-BR e en-US. */
async function seedPublicCommunity(ownerId: string, titulo = 'Moqueca da casa'): Promise<string> {
  const id = await seedRecipe({
    origin: 'ai_chat',
    originalLocale: 'pt-BR',
    visibility: 'public',
    ownerId,
  })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  await seedTranslation({ recipeId: id, locale: 'en-US', titulo: `${titulo} EN`, provenance: 'automatica_revisada' })
  return id
}

async function readRecipeRow(id: string) {
  const [row] = await getDb().select().from(recipe).where(eq(recipe.id, id))
  return row
}
async function readReport(reportId: string) {
  const [row] = await getDb().select().from(report).where(eq(report.id, reportId))
  return row
}

type QueueBody = { reports: { id: string; recipeId: string; origin: string; resultKind: string; reason: string }[] }

// ════════════════════════════════════════════════════════════════════════════════
describe('Moderação reativa (#18)', () => {
  // ── AC1: reportar receita pública cria Report na fila do Curador ─────────────────
  it('AC1 report em receita PÚBLICA (e Catálogo) ⇒ 201; entra na fila com origin+result_kind', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac1-owner@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'ac1-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'ac1-cur@ex.com', role: 'curador' })

    const comunidade = await seedPublicCommunity(owner)
    const catalogo = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: catalogo, locale: 'pt-BR', titulo: 'Feijoada', provenance: 'escrita_por_pessoa' })

    const r1 = await reportRecipe(comunidade, { reason: 'conteúdo impróprio' }, reporter)
    expect(r1.status).toBe(201)
    const b1 = (await r1.json()) as { reportId: string }
    expect(b1.reportId).toBeTruthy()

    const r2 = await reportRecipe(catalogo, { reason: 'erro grave' }, reporter)
    expect(r2.status).toBe(201)

    // a linha entra em report pending
    const row = await readReport(b1.reportId)
    expect(row.status).toBe('pending')
    expect(row.recipeId).toBe(comunidade)

    // fila do Curador lista os dois COM origin + result_kind
    const q = await reportsQueue(curador)
    expect(q.status).toBe(200)
    const qb = (await q.json()) as QueueBody
    const byRecipe = new Map(qb.reports.map((x) => [x.recipeId, x]))
    expect(byRecipe.get(comunidade)?.origin).toBe('ai_chat')
    expect(byRecipe.get(comunidade)?.resultKind).toBe('success')
    expect(byRecipe.get(catalogo)?.origin).toBe('catalog')
    expect(qb.reports.length).toBe(2)
  })

  it('AC1 fila lista por data ASC; seedReport pré-existente aparece com origin/result_kind', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac1q-owner@ex.com' })
    const { userId: reporterId } = await seedSessionHeaders({ email: 'ac1q-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'ac1q-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)

    const older = await seedReport({ recipeId: id, reporterId, reason: 'antigo' })
    const newer = await seedReport({ recipeId: id, reporterId, reason: 'novo' })
    // um já-resolvido NÃO aparece na fila (só pending)
    await seedReport({ recipeId: id, reporterId, reason: 'fechado', status: 'rejected' })

    const q = await reportsQueue(curador)
    const qb = (await q.json()) as QueueBody
    expect(qb.reports.map((r) => r.id)).toEqual([older, newer]) // ASC por createdAt, sem o rejected
    expect(qb.reports[0]).toMatchObject({ origin: 'ai_chat', resultKind: 'success', reason: 'antigo' })
  })

  it('AC1 anônimo ⇒ 401, ZERO efeito; reason vazio ⇒ 400; privada-de-outro/playful/inexistente ⇒ 404', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac1n-owner@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'ac1n-reporter@ex.com' })
    const pub = await seedPublicCommunity(owner)

    const anon = await reportRecipe(pub, { reason: 'x' })
    expect(anon.status).toBe(401)
    expect((await getDb().select().from(report)).length).toBe(0)

    const vazio = await reportRecipe(pub, { reason: '   ' }, reporter)
    expect(vazio.status).toBe(400)
    await expect(vazio.json()).resolves.toMatchObject({ error: 'dados_invalidos' })
    expect((await getDb().select().from(report)).length).toBe(0)

    // privada de outro
    const priv = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: owner })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Segredo', provenance: 'escrita_por_pessoa' })
    expect((await reportRecipe(priv, { reason: 'x' }, reporter)).status).toBe(404)

    // playful
    const play = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'private', resultKind: 'playful', ownerId: owner })
    await seedTranslation({ recipeId: play, locale: 'pt-BR', titulo: 'Zoeira', provenance: 'escrita_por_pessoa' })
    expect((await reportRecipe(play, { reason: 'x' }, reporter)).status).toBe(404)

    // inexistente + id inválido
    expect((await reportRecipe('00000000-0000-0000-0000-000000000000', { reason: 'x' }, reporter)).status).toBe(404)
    expect((await reportRecipe('not-a-uuid', { reason: 'x' }, reporter)).status).toBe(404)

    expect((await getDb().select().from(report)).length).toBe(0)
  })

  // ── AC2: Curador remove registrando motivo; NÃO é gate de publicação ─────────────
  it('AC2 remove com motivo ⇒ 200; grava colunas de moderação; report resolved; visibility/origin INTACTOS', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac2-owner@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'ac2-reporter@ex.com' })
    const { userId: curId, headers: curador } = await seedSessionHeaders({ email: 'ac2-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const reportId = (await reportRecipe(id, { reason: 'spam' }, reporter).then((r) => r.json())) as { reportId: string }

    const reasonVazio = await remove(reportId.reportId, { reason: '' }, curador)
    expect(reasonVazio.status).toBe(400)

    const res = await remove(reportId.reportId, { reason: 'viola diretrizes' }, curador)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    const row = await readRecipeRow(id)
    expect(row.moderationRemovedAt).not.toBeNull()
    expect(row.moderationReason).toBe('viola diretrizes')
    expect(row.moderatedBy).toBe(curId)
    expect(row.visibility).toBe('public') // remover-do-pool NÃO toca visibility
    expect(row.origin).toBe('ai_chat') // origin intocado

    const rep = await readReport(reportId.reportId)
    expect(rep.status).toBe('resolved')
    expect(rep.resolvedBy).toBe(curId)
    expect(rep.resolvedAt).not.toBeNull()
  })

  it('AC2 self-publish #13 segue SEM curadoria: uma pública SEM report aparece na busca e é legível', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac2sp-owner@ex.com' })
    const id = await seedPublicCommunity(owner, 'Bolo de fubá especial')

    const s = (await (await search('q=fubá')).json()) as { comunidade: { recipeId: string }[] }
    expect(s.comunidade.map((r) => r.recipeId)).toContain(id)
    expect((await get(id)).status).toBe(200) // remover-do-pool NÃO é gate de publicação
  })

  // ── AC3: remover-do-pool distinto de despublicar; owner mantém a linha privada ────
  it('AC3 removida: some da busca (pt-BR+en-US) e do GET anônimo/não-dono; DONO ainda lê', async () => {
    const { userId: owner, headers: ownerH } = await seedSessionHeaders({ email: 'ac3-owner@ex.com' })
    const { headers: otherH } = await seedSessionHeaders({ email: 'ac3-other@ex.com' })
    const { userId: curId } = await seedSessionHeaders({ email: 'ac3-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner, 'Curry de abóbora')
    await seedRemovedFromPool({ recipeId: id, curatorId: curId })

    // busca em ambos os locales não a traz
    const sPt = (await (await search('q=abóbora&locale=pt-BR')).json()) as { comunidade: { recipeId: string }[] }
    expect(sPt.comunidade.map((r) => r.recipeId)).not.toContain(id)
    const sEn = (await (await search('q=abóbora&locale=en-US')).json()) as { comunidade: { recipeId: string }[] }
    expect(sEn.comunidade.map((r) => r.recipeId)).not.toContain(id)

    // anônimo + não-dono → 404
    expect((await get(id)).status).toBe(404)
    expect((await get(id, otherH)).status).toBe(404)

    // DONO ainda lê a própria linha privada (200)
    const mine = await get(id, ownerH)
    expect(mine.status).toBe(200)
    const view = (await mine.json()) as { canManage?: boolean; moderationReason?: unknown }
    expect(view.canManage).toBe(true)
    expect(view.moderationReason).toBeUndefined() // moderation_reason NUNCA chega à view

    // visibility permanece 'public' no banco
    expect((await readRecipeRow(id)).visibility).toBe('public')
  })

  it('AC3 [FIX-B2] republish-after-removal: moderação prevalece sobre visibility (não ressuscita)', async () => {
    const { userId: owner, headers: ownerH } = await seedSessionHeaders({ email: 'ac3rp-owner@ex.com' })
    const { userId: curId } = await seedSessionHeaders({ email: 'ac3rp-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner, 'Lasanha à bolonhesa')
    await seedRemovedFromPool({ recipeId: id, curatorId: curId })

    // dono faz unpublish → publish (#13; ambos 200, NÃO tocam moderação)
    expect((await unpublish(id, ownerH)).status).toBe(200)
    expect((await publish(id, ownerH)).status).toBe(200)

    // moderação prevalece: ainda fora da busca e GET anônimo 404
    const s = (await (await search('q=lasanha')).json()) as { comunidade: { recipeId: string }[] }
    expect(s.comunidade.map((r) => r.recipeId)).not.toContain(id)
    expect((await get(id)).status).toBe(404)

    // as colunas de moderação seguem setadas
    const row = await readRecipeRow(id)
    expect(row.moderationRemovedAt).not.toBeNull()
    expect(row.visibility).toBe('public')
  })

  it('AC3 [FIX-B1] múltiplos reports: a proveniência da 1ª remoção é preservada', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'b1-owner@ex.com' })
    const { headers: rep1 } = await seedSessionHeaders({ email: 'b1-rep1@ex.com' })
    const { headers: rep2 } = await seedSessionHeaders({ email: 'b1-rep2@ex.com' })
    const { userId: curA, headers: curAH } = await seedSessionHeaders({ email: 'b1-curA@ex.com', role: 'curador' })
    const { headers: curBH } = await seedSessionHeaders({ email: 'b1-curB@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const rA = ((await (await reportRecipe(id, { reason: 'rA' }, rep1)).json()) as { reportId: string }).reportId
    const rB = ((await (await reportRecipe(id, { reason: 'rB' }, rep2)).json()) as { reportId: string }).reportId

    const resA = await remove(rA, { reason: 'motivo A' }, curAH)
    expect(resA.status).toBe(200)
    const after1 = await readRecipeRow(id)
    const tA = after1.moderationRemovedAt
    expect(after1.moderatedBy).toBe(curA)
    expect(after1.moderationReason).toBe('motivo A')

    // remove via report B por outro Curador — NÃO sobrescreve a proveniência da 1ª
    const resB = await remove(rB, { reason: 'motivo B' }, curBH)
    expect(resB.status).toBe(200)
    const after2 = await readRecipeRow(id)
    expect(after2.moderatedBy).toBe(curA) // INALTERADO
    expect(after2.moderationReason).toBe('motivo A') // INALTERADO
    expect(after2.moderationRemovedAt?.getTime()).toBe(tA?.getTime()) // INALTERADO
    // report B resolvido mesmo assim
    expect((await readReport(rB)).status).toBe('resolved')
  })

  // ── AC4: mesma Receita em pt-BR e en-US; sem leak/escrita de conteúdo moderado ────
  it('AC4 [FIX-B3] removida: translations POST de não-dono ⇒ 404 e NENHUMA escrita; dono mantém acesso', async () => {
    const { userId: owner, headers: ownerH } = await seedSessionHeaders({ email: 'ac4-owner@ex.com' })
    const { headers: otherH } = await seedSessionHeaders({ email: 'ac4-other@ex.com' })
    const { userId: curId } = await seedSessionHeaders({ email: 'ac4-cur@ex.com', role: 'curador' })
    // só pt-BR seedada; en-US seria gerada por ensureTranslation
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: owner })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Risoto', provenance: 'escrita_por_pessoa' })
    await seedRemovedFromPool({ recipeId: id, curatorId: curId })

    const transBefore = (await getDb().select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))).length
    const embedBefore = (await getDb().select().from(recipeEmbedding).where(eq(recipeEmbedding.recipeId, id))).length

    // não-dono tenta gerar en-US ⇒ 404, sem escrita; anônimo idem
    expect((await translate(id, 'en-US', otherH)).status).toBe(404)
    expect((await translate(id, 'en-US')).status).toBe(401)

    const transAfter = (await getDb().select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))).length
    const embedAfter = (await getDb().select().from(recipeEmbedding).where(eq(recipeEmbedding.recipeId, id))).length
    expect(transAfter).toBe(transBefore) // ensureTranslation pulado
    expect(embedAfter).toBe(embedBefore)

    // dono mantém acesso (200) sem gerar tradução de conteúdo moderado
    const ownerRes = await translate(id, 'en-US', ownerH)
    expect(ownerRes.status).toBe(200)
    const transAfterOwner = (await getDb().select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))).length
    expect(transAfterOwner).toBe(transBefore) // ainda sem escrita de tradução
  })

  // ── AC5: #18 NÃO muta a base (derivada é #17, deferida) ──────────────────────────
  it('AC5 byte-a-byte: remove NÃO altera recipe_translation (titulo/passos/descricao/notas)', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'ac5-owner@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'ac5-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'ac5-cur@ex.com', role: 'curador' })
    const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId: owner })
    await seedTranslation({
      recipeId: id,
      locale: 'pt-BR',
      titulo: 'Pão de queijo',
      descricao: 'mineiro',
      passos: ['misture', 'asse'],
      notas: 'sirva quente',
      provenance: 'escrita_por_pessoa',
    })
    const before = await getDb().select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    const reportId = ((await (await reportRecipe(id, { reason: 'x' }, reporter)).json()) as { reportId: string }).reportId

    await remove(reportId, { reason: 'remover' }, curador)

    const after = await getDb().select().from(recipeTranslation).where(eq(recipeTranslation.recipeId, id))
    expect(after).toEqual(before) // conteúdo IDÊNTICO — moderação não muta a base
  })

  it('AC5 role-gating: moderação exige Curador (fail-closed); Curador NÃO acessa config', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rg-owner@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'rg-reporter@ex.com' })
    const { headers: usuarioH } = await seedSessionHeaders({ email: 'rg-usuario@ex.com', role: 'usuario' })
    const { headers: curadorH } = await seedSessionHeaders({ email: 'rg-cur@ex.com', role: 'curador' })
    const { headers: adminH } = await seedSessionHeaders({ email: 'rg-admin@ex.com', role: 'admin' })
    const { headers: deletedH } = await seedDeletedSessionHeaders({ email: 'rg-del@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const reportId = ((await (await reportRecipe(id, { reason: 'x' }, reporter)).json()) as { reportId: string }).reportId

    // fila: anon 401, usuario 403, curador 200, admin 200, soft-deletada 401
    expect((await reportsQueue()).status).toBe(401)
    expect((await reportsQueue(usuarioH)).status).toBe(403)
    expect((await reportsQueue(curadorH)).status).toBe(200)
    expect((await reportsQueue(adminH)).status).toBe(200)
    expect((await reportsQueue(deletedH)).status).toBe(401)

    // remove: anon 401, usuario 403 papel_insuficiente
    expect((await remove(reportId, { reason: 'x' })).status).toBe(401)
    const u403 = await remove(reportId, { reason: 'x' }, usuarioH)
    expect(u403.status).toBe(403)
    await expect(u403.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })

    // keep: anon 401, usuario 403
    expect((await keep(reportId)).status).toBe(401)
    expect((await keep(reportId, usuarioH)).status).toBe(403)

    // não-regressão AC5: Curador NÃO acessa config do app (admin-only)
    const cfgGet = await adminConfigGet(new Request('http://localhost/api/admin/config', { headers: curadorH }))
    expect(cfgGet.status).toBe(403)
    await expect(cfgGet.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })
    const cfgPut = await adminConfigPut(
      new Request('http://localhost/api/admin/config', {
        method: 'PUT',
        headers: curadorH,
        body: JSON.stringify({ defaultModel: 'claude-opus-4-8' }),
      }),
    )
    expect(cfgPut.status).toBe(403)
  })

  // ── keep + persistência de saves + idempotência ─────────────────────────────
  it('keep mantém no pool; saves sobrevivem à remoção; save em removida ⇒ 404; já-resolvido ⇒ 409', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'k-owner@ex.com' })
    const { headers: saverH } = await seedSessionHeaders({ email: 'k-saver@ex.com' })
    const { userId: favId } = await seedSessionHeaders({ email: 'k-fav@ex.com' })
    const { headers: reporter } = await seedSessionHeaders({ email: 'k-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'k-cur@ex.com', role: 'curador' })

    // keep: receita PERMANECE no pool
    const keepId = await seedPublicCommunity(owner, 'Sopa de cebola')
    const repKeep = ((await (await reportRecipe(keepId, { reason: 'x' }, reporter)).json()) as { reportId: string }).reportId
    const k = await keep(repKeep, curador)
    expect(k.status).toBe(200)
    expect((await readReport(repKeep)).status).toBe('rejected')
    expect((await get(keepId)).status).toBe(200) // ainda legível
    const sKeep = (await (await search('q=cebola')).json()) as { comunidade: { recipeId: string }[] }
    expect(sKeep.comunidade.map((r) => r.recipeId)).toContain(keepId)

    // remove: saves pré-existentes PERSISTEM (sem DELETE)
    const remId = await seedPublicCommunity(owner, 'Torta de limão')
    await seedSave({ userId: favId, recipeId: remId })
    const repRem = ((await (await reportRecipe(remId, { reason: 'x' }, reporter)).json()) as { reportId: string }).reportId
    expect((await remove(repRem, { reason: 'fora' }, curador)).status).toBe(200)
    expect((await getDb().select().from(recipeSave).where(eq(recipeSave.recipeId, remId))).length).toBe(1)

    // salvar numa removida ⇒ 404 (quem salvou deixa de ver, igual despublicar)
    expect((await save(remId, saverH)).status).toBe(404)

    // anti-corrida: remove/keep sobre report não-pending ⇒ 409 ja_resolvido
    const dup = await remove(repRem, { reason: 'de novo' }, curador)
    expect(dup.status).toBe(409)
    await expect(dup.json()).resolves.toMatchObject({ error: 'ja_resolvido' })
    expect((await keep(repKeep, curador)).status).toBe(409)

    // report/keep em id inexistente ⇒ 404
    expect((await remove('00000000-0000-0000-0000-000000000000', { reason: 'x' }, curador)).status).toBe(404)
    expect((await keep('00000000-0000-0000-0000-000000000000', curador)).status).toBe(404)
  })

  // ── Migration / CHECK de moderação ──────────────────────────────────────────────
  it('CHECK recipe_moderation_consistency_chk rejeita removed_at sem moderated_by (e vice-versa)', async () => {
    const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'X', provenance: 'escrita_por_pessoa' })

    let err: unknown
    try {
      await sql`UPDATE recipe SET moderation_removed_at = now() WHERE id = ${id}`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // viola o CHECK (removed_at setado, moderated_by NULL)

    err = undefined
    try {
      // moderated_by precisa de um user real para não cair no FK antes do CHECK
      const ownerId = (await seedSessionHeaders({ email: 'chk@ex.com' })).userId
      await sql`UPDATE recipe SET moderated_by = ${ownerId} WHERE id = ${id}`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // viola o CHECK (moderated_by setado, removed_at NULL)
  })
})
