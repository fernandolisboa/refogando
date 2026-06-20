import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipe, recipeImage, report } from '@/db/schema'
import { POST as removeImageRoute } from '@/app/api/curate/reports/[id]/remove-image/route'
import { GET as recipeGet } from '@/app/api/recipes/[id]/route'
import { GET as feedGet } from '@/app/api/feed/route'
import { GET as searchGet } from '@/app/api/search/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedReport, seedRecipeImage } from '../helpers/recipes'

/**
 * Moderar SÓ A IMAGEM (#133, ADR-0016) pela porta MAIS ALTA (route handlers + Postgres descartável).
 * Eixo ORTOGONAL a remover-do-pool (#18): o Curador esconde a foto do público em TODA PARTE (feed,
 * busca, detalhe), mas a Receita CONTINUA no pool e legível; o Owner ainda vê a própria imagem.
 * Modelo de invocação espelha moderation.test.ts (Request cru + params Promise; sessão por papel).
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function removeImage(reportId: string, body: unknown, headers?: Headers): Promise<Response> {
  return removeImageRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/remove-image`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
function get(id: string, headers?: Headers): Promise<Response> {
  return recipeGet(new Request(`http://localhost/api/recipes/${id}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}
function feed(qs = 'locale=pt-BR'): Promise<Response> {
  return feedGet(new Request(`http://localhost/api/feed?${qs}`))
}
function search(qs: string): Promise<Response> {
  return searchGet(new Request(`http://localhost/api/search?${qs}`))
}

// ── Leituras diretas ──────────────────────────────────────────────────────────
async function readImage(imageId: string) {
  const [row] = await getDb().select().from(recipeImage).where(eq(recipeImage.id, imageId))
  return row
}
async function readRecipe(id: string) {
  const [row] = await getDb().select().from(recipe).where(eq(recipe.id, id))
  return row
}
async function readReport(reportId: string) {
  const [row] = await getDb().select().from(report).where(eq(report.id, reportId))
  return row
}

// ── Seeds compostos ─────────────────────────────────────────────────────────────
/** Comunidade PÚBLICA com dono + título buscável (pt-BR e en-US). */
async function seedPublicCommunity(ownerId: string, titulo: string): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  await seedTranslation({ recipeId: id, locale: 'en-US', titulo: `${titulo} EN`, provenance: 'automatica_revisada' })
  return id
}
/** Catálogo (owner NULL) com título buscável — visível na busca/feed via gate owner-NULL. */
async function seedCatalog(titulo: string): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, resultKind: 'success' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

type Item = { recipeId: string; imageUrl?: string }

// ════════════════════════════════════════════════════════════════════════════════
describe('Moderar só a imagem (#133)', () => {
  // ── Gating de papel + happy path: modera a imagem, resolve o report, Receita SEGUE no pool ──
  it('curador remove-image ⇒ 200; imagem moderada + report resolved; Receita PERMANECE no pool e legível', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'im-owner@ex.com' })
    const { userId: reporterId } = await seedSessionHeaders({ email: 'im-reporter@ex.com' })
    const { userId: curId, headers: curador } = await seedSessionHeaders({ email: 'im-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner, 'Moqueca fotografada')
    const imageId = await seedRecipeImage({ recipeId: id })
    const reportId = await seedReport({ recipeId: id, reporterId, reason: 'foto imprópria' })

    // motivo vazio ⇒ 400, sem efeito
    const vazio = await removeImage(reportId, { reason: '   ' }, curador)
    expect(vazio.status).toBe(400)
    expect((await readImage(imageId)).moderatedAt).toBeNull()
    expect((await readReport(reportId)).status).toBe('pending')

    const res = await removeImage(reportId, { reason: 'viola diretrizes' }, curador)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    // imagem moderada (proveniência registrada); Receita NÃO tocada (segue no pool)
    const img = await readImage(imageId)
    expect(img.moderatedAt).not.toBeNull()
    expect(img.moderatedReason).toBe('viola diretrizes')
    expect(img.moderatedBy).toBe(curId)
    const rec = await readRecipe(id)
    expect(rec.moderationRemovedAt).toBeNull() // NÃO removeu a Receita do pool (eixo ortogonal)
    expect(rec.imageId).toBe(imageId) // image_id intocado (blob preservado, só escondido)

    // report resolvido
    const rep = await readReport(reportId)
    expect(rep.status).toBe('resolved')
    expect(rep.resolvedBy).toBe(curId)

    // Receita continua legível (anônimo 200) e na busca — só a foto some
    expect((await get(id)).status).toBe(200)
    const s = (await (await search('q=Moqueca%20fotografada&locale=pt-BR')).json()) as { comunidade: Item[] }
    expect(s.comunidade.map((r) => r.recipeId)).toContain(id)
  })

  it('role-gating fail-closed: anon 401, usuario 403 papel_insuficiente, curador/admin 200', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'imrg-owner@ex.com' })
    const { userId: reporterId } = await seedSessionHeaders({ email: 'imrg-reporter@ex.com' })
    const { headers: usuarioH } = await seedSessionHeaders({ email: 'imrg-usuario@ex.com', role: 'usuario' })
    const { headers: curadorH } = await seedSessionHeaders({ email: 'imrg-cur@ex.com', role: 'curador' })
    const { headers: adminH } = await seedSessionHeaders({ email: 'imrg-admin@ex.com', role: 'admin' })
    const id = await seedPublicCommunity(owner, 'Risoto guardado')
    await seedRecipeImage({ recipeId: id })

    const rep1 = await seedReport({ recipeId: id, reporterId, reason: 'a' })
    expect((await removeImage(rep1, { reason: 'x' })).status).toBe(401)
    const u403 = await removeImage(rep1, { reason: 'x' }, usuarioH)
    expect(u403.status).toBe(403)
    await expect(u403.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })
    // report intacto após as tentativas negadas
    expect((await readReport(rep1)).status).toBe('pending')

    // curador resolve rep1; admin resolve um segundo report (admin passa o gate 'curador')
    expect((await removeImage(rep1, { reason: 'ok' }, curadorH)).status).toBe(200)
    const rep2 = await seedReport({ recipeId: id, reporterId, reason: 'b' })
    expect((await removeImage(rep2, { reason: 'ok' }, adminH)).status).toBe(200)
  })

  // ── no_image 422: a Receita reportada não tem imagem a remover (report NÃO é resolvido) ──
  it('Receita SEM imagem ⇒ 422 sem_imagem; report continua pending; id inexistente ⇒ 404', async () => {
    const { userId: reporterId } = await seedSessionHeaders({ email: 'imni-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'imni-cur@ex.com', role: 'curador' })
    const id = await seedCatalog('Sopa sem foto alguma')
    const reportId = await seedReport({ recipeId: id, reporterId, reason: 'sem foto' })

    const res = await removeImage(reportId, { reason: 'tentando' }, curador)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'sem_imagem' })
    expect((await readReport(reportId)).status).toBe('pending') // 422 NÃO resolve o report

    // report inexistente (uuid válido) ⇒ 404; id malformado ⇒ 404
    expect((await removeImage('00000000-0000-0000-0000-000000000000', { reason: 'x' }, curador)).status).toBe(404)
    expect((await removeImage('not-a-uuid', { reason: 'x' }, curador)).status).toBe(404)
  })

  // ── Proveniência da 1ª moderação preservada + anti-corrida ────────────────────────
  it('múltiplos reports: a 1ª moderação preservada (re-moderar não sobrescreve); já-resolvido ⇒ 409', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'imb1-owner@ex.com' })
    const { userId: reporterId } = await seedSessionHeaders({ email: 'imb1-reporter@ex.com' })
    const { userId: curA, headers: curAH } = await seedSessionHeaders({ email: 'imb1-curA@ex.com', role: 'curador' })
    const { headers: curBH } = await seedSessionHeaders({ email: 'imb1-curB@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner, 'Lasanha em camadas')
    const imageId = await seedRecipeImage({ recipeId: id })
    const rA = await seedReport({ recipeId: id, reporterId, reason: 'rA' })
    const rB = await seedReport({ recipeId: id, reporterId, reason: 'rB' })

    expect((await removeImage(rA, { reason: 'motivo A' }, curAH)).status).toBe(200)
    const after1 = await readImage(imageId)
    const tA = after1.moderatedAt
    expect(after1.moderatedBy).toBe(curA)
    expect(after1.moderatedReason).toBe('motivo A')

    // 2º curador modera via report B ⇒ resolve B, mas NÃO sobrescreve a proveniência da 1ª
    expect((await removeImage(rB, { reason: 'motivo B' }, curBH)).status).toBe(200)
    const after2 = await readImage(imageId)
    expect(after2.moderatedBy).toBe(curA) // INALTERADO
    expect(after2.moderatedReason).toBe('motivo A') // INALTERADO
    expect(after2.moderatedAt?.getTime()).toBe(tA?.getTime()) // INALTERADO
    expect((await readReport(rB)).status).toBe('resolved')

    // anti-corrida: re-moderar via report A (já resolvido) ⇒ 409 ja_resolvido
    const dup = await removeImage(rA, { reason: 'de novo' }, curAH)
    expect(dup.status).toBe(409)
    await expect(dup.json()).resolves.toMatchObject({ error: 'ja_resolvido' })

    // a Receita NUNCA saiu do pool durante tudo isso
    expect((await readRecipe(id)).moderationRemovedAt).toBeNull()
  })

  // ── Gate de pool: imagem moderada some do FEED e da BUSCA; a Receita PERMANECE ───────
  it('feed/busca: imagem moderada some (imageUrl ausente), mas a Receita continua listada', async () => {
    const { userId: curId } = await seedSessionHeaders({ email: 'impool-cur@ex.com' })
    const moderada = await seedCatalog('Bolo moderado de fubá')
    await seedRecipeImage({ recipeId: moderada, moderated: { curatorId: curId } })
    const normal = await seedCatalog('Bolo visível de fubá')
    await seedRecipeImage({ recipeId: normal })

    // feed: ambas presentes; só a normal traz imageUrl
    const fb = (await (await feed()).json()) as { feed: Item[] }
    const fModer = fb.feed.find((i) => i.recipeId === moderada)
    const fNormal = fb.feed.find((i) => i.recipeId === normal)
    expect(fModer).toBeDefined() // a Receita SEGUE no feed (eixo ortogonal)
    expect(fModer!.imageUrl).toBeUndefined() // foto escondida do público
    expect(fNormal?.imageUrl).toBeDefined() // controle: a não-moderada mostra a foto

    // busca (pt-BR): mesma coisa via o JOIN do displayTailSql
    const sb = (await (await search('q=fub%C3%A1&locale=pt-BR')).json()) as { catalogo: Item[] }
    const sModer = sb.catalogo.find((i) => i.recipeId === moderada)
    const sNormal = sb.catalogo.find((i) => i.recipeId === normal)
    expect(sModer).toBeDefined()
    expect(sModer!.imageUrl).toBeUndefined()
    expect(sNormal?.imageUrl).toBeDefined()
  })

  // ── Gate de detalhe: público/não-dono NÃO vê; Owner (canManage) AINDA vê ─────────────
  it('detalhe: imagem moderada some p/ anônimo e não-dono (com selo de IA); Owner ainda vê', async () => {
    const { userId: owner, headers: ownerH } = await seedSessionHeaders({ email: 'imdet-owner@ex.com' })
    const { headers: otherH } = await seedSessionHeaders({ email: 'imdet-other@ex.com' })
    const { userId: curId } = await seedSessionHeaders({ email: 'imdet-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner, 'Pizza autoral detalhada')
    // imagem GERADA POR IA já moderada — exercita o gate do selo junto da foto
    await seedRecipeImage({ recipeId: id, provenance: 'ai_generated', moderated: { curatorId: curId } })

    type View = { imageUrl?: string; imageAiGenerated?: boolean; canManage?: boolean }

    // anônimo: 200 (Receita no pool), SEM foto e SEM selo de IA
    const anon = await get(id)
    expect(anon.status).toBe(200)
    const anonView = (await anon.json()) as View
    expect(anonView.imageUrl).toBeUndefined()
    expect(anonView.imageAiGenerated).toBeUndefined()

    // não-dono logado: idem (gate é por ownership, não por estar logado)
    const other = await get(id, otherH)
    expect(other.status).toBe(200)
    const otherView = (await other.json()) as View
    expect(otherView.imageUrl).toBeUndefined()
    expect(otherView.imageAiGenerated).toBeUndefined()
    expect(otherView.canManage).toBeUndefined()

    // Owner (canManage): AINDA vê a própria imagem moderada + o selo de IA
    const mine = await get(id, ownerH)
    expect(mine.status).toBe(200)
    const myView = (await mine.json()) as View
    expect(myView.canManage).toBe(true)
    expect(myView.imageUrl).toBeDefined()
    expect(myView.imageAiGenerated).toBe(true)
  })
})
