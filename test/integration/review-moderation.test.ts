import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { and, eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb } from '@/server/deps'
import { recipeReview, report, users } from '@/db/schema'
import { listReportQueue } from '@/server/curate/reports'
import { POST as removeReviewRoute } from '@/app/api/curate/reports/[id]/remove-review/route'
import { POST as reportReviewRoute } from '@/app/api/reviews/[reviewId]/report/route'
import { POST as keepRoute } from '@/app/api/curate/reports/[id]/keep/route'
import { POST as removeRoute } from '@/app/api/curate/reports/[id]/remove/route'
import { POST as removeImageRoute } from '@/app/api/curate/reports/[id]/remove-image/route'
import {
  GET as reviewGet,
  POST as reviewPost,
  DELETE as reviewDelete,
} from '@/app/api/recipes/[id]/reviews/route'
import { GET as mineGet } from '@/app/api/recipes/[id]/reviews/mine/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedTranslation, seedReport, seedReview } from '../helpers/recipes'

/**
 * Moderação de AVALIAÇÃO (report→Curador, #366, ADR-0027) pela porta MAIS ALTA (route handlers +
 * Postgres descartável). Espelha image-moderation.test.ts: o Curador esconde a avaliação INTEIRA
 * (nota+comentário+foto) do público/agregado de forma LÓGICA; a linha PERSISTE; o dono NÃO remove
 * (só reporta). Cobre as correções M1–M6 + os CHECKs (consistência de moderação e alvo XOR).
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

// ── Invocadores de porta alta ─────────────────────────────────────────────────
function removeReview(reportId: string, body: unknown, headers?: Headers): Promise<Response> {
  return removeReviewRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/remove-review`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
function reportReview(reviewId: string, body: unknown, headers?: Headers): Promise<Response> {
  return reportReviewRoute(
    new Request(`http://localhost/api/reviews/${reviewId}/report`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ reviewId }) },
  )
}
function keep(reportId: string, headers?: Headers): Promise<Response> {
  return keepRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/keep`, { method: 'POST', headers }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
function removeRecipe(reportId: string, body: unknown, headers?: Headers): Promise<Response> {
  return removeRoute(
    new Request(`http://localhost/api/curate/reports/${reportId}/remove`, {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: reportId }) },
  )
}
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
function postReview(id: string, body: unknown, headers?: Headers): Promise<Response> {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return reviewPost(
    new Request(`http://localhost/api/recipes/${id}/reviews`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}
function deleteReview(id: string, headers?: Headers): Promise<Response> {
  return reviewDelete(
    new Request(`http://localhost/api/recipes/${id}/reviews`, { method: 'DELETE', headers }),
    { params: Promise.resolve({ id }) },
  )
}
function getReviews(id: string): Promise<Response> {
  return reviewGet(new Request(`http://localhost/api/recipes/${id}/reviews`), {
    params: Promise.resolve({ id }),
  })
}
function getMine(id: string, headers?: Headers): Promise<Response> {
  return mineGet(new Request(`http://localhost/api/recipes/${id}/reviews/mine`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

// ── Leituras diretas ──────────────────────────────────────────────────────────
async function readReview(reviewId: string) {
  const [row] = await getDb().select().from(recipeReview).where(eq(recipeReview.id, reviewId))
  return row
}
async function readReport(reportId: string) {
  const [row] = await getDb().select().from(report).where(eq(report.id, reportId))
  return row
}
async function reviewIdOf(userId: string, recipeId: string): Promise<string> {
  const [row] = await getDb()
    .select({ id: recipeReview.id })
    .from(recipeReview)
    .where(and(eq(recipeReview.userId, userId), eq(recipeReview.recipeId, recipeId)))
  return row.id
}

// ── Seeds compostos ─────────────────────────────────────────────────────────────
async function seedPublicCommunity(ownerId: string, titulo = 'Moqueca da casa'): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', visibility: 'public', ownerId })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}
type ListBody = { average: number | null; count: number; reviews: { id: string }[] }

// ════════════════════════════════════════════════════════════════════════════════
describe('Moderação de avaliação (#366)', () => {
  // ── Criar report de avaliação ──────────────────────────────────────────────────
  it('report de avaliação (qualquer usuário) ⇒ 201 com review_id; fora do pool ⇒ 404; já-moderada ⇒ 404 (M5); vazio ⇒ 400', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rm-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'rm-reviewer@ex.com' })
    const { userId: reviewer2Id } = await seedSessionHeaders({ email: 'rm-reviewer2@ex.com' })
    const { userId: curId, headers: reporterH } = await seedSessionHeaders({ email: 'rm-reporter@ex.com' })
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 4, comment: 'ok' })

    // qualquer usuário autenticado reporta ⇒ 201, report com review_id set / recipe_id null
    const r = await reportReview(reviewId, { reason: 'ofensivo' }, reporterH)
    expect(r.status).toBe(201)
    const rid = ((await r.json()) as { reportId: string }).reportId
    expect(rid).toBeTruthy()
    const row = await readReport(rid)
    expect(row.reviewId).toBe(reviewId)
    expect(row.recipeId).toBeNull()
    expect(row.status).toBe('pending')

    // anônimo ⇒ 401 (sem efeito)
    expect((await reportReview(reviewId, { reason: 'x' })).status).toBe(401)

    // reason vazio ⇒ 400
    const vazio = await reportReview(reviewId, { reason: '   ' }, reporterH)
    expect(vazio.status).toBe(400)
    await expect(vazio.json()).resolves.toMatchObject({ error: 'dados_invalidos' })

    // avaliação de receita FORA do pool (privada de outro) ⇒ 404 leak-safe
    const priv = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', visibility: 'private', ownerId: owner })
    await seedTranslation({ recipeId: priv, locale: 'pt-BR', titulo: 'Segredo', provenance: 'escrita_por_pessoa' })
    const privReview = await seedReview({ userId: reviewerId, recipeId: priv, rating: 3 })
    expect((await reportReview(privReview, { reason: 'x' }, reporterH)).status).toBe(404)

    // M5: avaliação JÁ MODERADA ⇒ 404 (não reporta conteúdo já-oculto). Usa outro reviewer p/ não
    // colidir na UNIQUE (user_id, recipe_id) com a avaliação de reviewerId acima.
    const modReview = await seedReview({
      userId: reviewer2Id,
      recipeId: id,
      rating: 2,
      comment: 'ruim',
      moderated: { curatorId: curId },
    })
    expect((await reportReview(modReview, { reason: 'x' }, reporterH)).status).toBe(404)

    // avaliação inexistente / uuid inválido ⇒ 404
    expect((await reportReview('00000000-0000-0000-0000-000000000000', { reason: 'x' }, reporterH)).status).toBe(404)
    expect((await reportReview('not-a-uuid', { reason: 'x' }, reporterH)).status).toBe(404)
  })

  // ── Curador remove: modera a avaliação (3 cols juntas), resolve o report, some do agregado ──
  it('curador remove-review ⇒ 200; avaliação moderada (3 cols) + report resolved; some de lista/média; linha PERSISTE', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'rmv-owner@ex.com' })
    const { userId: aId } = await seedSessionHeaders({ email: 'rmv-a@ex.com' })
    const { userId: bId } = await seedSessionHeaders({ email: 'rmv-b@ex.com' })
    const { userId: curId, headers: curador } = await seedSessionHeaders({ email: 'rmv-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const revA = await seedReview({ userId: aId, recipeId: id, rating: 5, comment: 'delícia' })
    await seedReview({ userId: bId, recipeId: id, rating: 1, comment: 'péssimo' })
    const reportId = await seedReport({ reviewId: revA, reporterId: bId, reason: 'spam' })

    // antes: média (5+1)/2 = 3, contagem 2
    const before = (await (await getReviews(id)).json()) as ListBody
    expect(before).toMatchObject({ count: 2, average: 3 })

    // motivo vazio ⇒ 400, sem efeito
    const vazio = await removeReview(reportId, { reason: '  ' }, curador)
    expect(vazio.status).toBe(400)
    expect((await readReview(revA)).moderatedAt).toBeNull()
    expect((await readReport(reportId)).status).toBe('pending')

    const res = await removeReview(reportId, { reason: 'viola diretrizes' }, curador)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })

    // as 3 colunas de moderação JUNTAS (proveniência registrada)
    const rev = await readReview(revA)
    expect(rev.moderatedAt).not.toBeNull()
    expect(rev.moderatedReason).toBe('viola diretrizes')
    expect(rev.moderatedBy).toBe(curId)
    expect(rev.rating).toBe(5) // conteúdo intocado (remoção LÓGICA)

    // report resolvido
    const rep = await readReport(reportId)
    expect(rep.status).toBe('resolved')
    expect(rep.resolvedBy).toBe(curId)

    // some da lista + agregado: sobra só a nota 1 ⇒ média 1, contagem 1
    const after = (await (await getReviews(id)).json()) as ListBody
    expect(after).toMatchObject({ count: 1, average: 1 })
    expect(after.reviews.map((x) => x.id)).not.toContain(revA)
  })

  // ── Role-gating fail-closed: dono (usuario) NÃO remove ────────────────────────────
  it('role-gating: anon 401, usuario (mesmo dono da receita) 403 papel_insuficiente, curador 200, admin 200', async () => {
    const { userId: owner, headers: ownerH } = await seedSessionHeaders({ email: 'rg-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'rg-reviewer@ex.com' })
    const { headers: curadorH } = await seedSessionHeaders({ email: 'rg-cur@ex.com', role: 'curador' })
    const { headers: adminH } = await seedSessionHeaders({ email: 'rg-admin@ex.com', role: 'admin' })
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 3 })
    const rep1 = await seedReport({ reviewId, reporterId: reviewerId, reason: 'a' })

    // anon 401; DONO (papel usuario) 403 — o dono NÃO remove a avaliação, só reporta
    expect((await removeReview(rep1, { reason: 'x' })).status).toBe(401)
    const u403 = await removeReview(rep1, { reason: 'x' }, ownerH)
    expect(u403.status).toBe(403)
    await expect(u403.json()).resolves.toMatchObject({ error: 'papel_insuficiente' })
    expect((await readReport(rep1)).status).toBe('pending') // intacto

    // curador resolve rep1; admin resolve um segundo report (herda o gate 'curador')
    expect((await removeReview(rep1, { reason: 'ok' }, curadorH)).status).toBe(200)
    const rep2 = await seedReport({ reviewId, reporterId: reviewerId, reason: 'b' })
    expect((await removeReview(rep2, { reason: 'ok' }, adminH)).status).toBe(200)
  })

  // ── Proveniência da 1ª moderação preservada + anti-corrida ────────────────────────
  it('múltiplos reports/curadores: a 1ª moderação é preservada; já-resolvido ⇒ 409', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'pf-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'pf-reviewer@ex.com' })
    const { userId: curA, headers: curAH } = await seedSessionHeaders({ email: 'pf-curA@ex.com', role: 'curador' })
    const { headers: curBH } = await seedSessionHeaders({ email: 'pf-curB@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 2 })
    const rA = await seedReport({ reviewId, reporterId: reviewerId, reason: 'rA' })
    const rB = await seedReport({ reviewId, reporterId: reviewerId, reason: 'rB' })

    expect((await removeReview(rA, { reason: 'motivo A' }, curAH)).status).toBe(200)
    const after1 = await readReview(reviewId)
    const tA = after1.moderatedAt
    expect(after1.moderatedBy).toBe(curA)
    expect(after1.moderatedReason).toBe('motivo A')

    // 2º curador via rB ⇒ resolve rB, mas NÃO sobrescreve a 1ª proveniência
    expect((await removeReview(rB, { reason: 'motivo B' }, curBH)).status).toBe(200)
    const after2 = await readReview(reviewId)
    expect(after2.moderatedBy).toBe(curA) // INALTERADO
    expect(after2.moderatedReason).toBe('motivo A') // INALTERADO
    expect(after2.moderatedAt?.getTime()).toBe(tA?.getTime()) // INALTERADO
    expect((await readReport(rB)).status).toBe('resolved')

    // anti-corrida: re-moderar via rA (já resolvido) ⇒ 409 ja_resolvido
    const dup = await removeReview(rA, { reason: 'de novo' }, curAH)
    expect(dup.status).toBe(409)
    await expect(dup.json()).resolves.toMatchObject({ error: 'ja_resolvido' })
  })

  // ── no_review 422: remove-review sobre um report de RECEITA ────────────────────────
  it('remove-review num report de RECEITA (review_id null) ⇒ 422 sem_avaliacao; report segue pending', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'nr-owner@ex.com' })
    const { userId: reporterId } = await seedSessionHeaders({ email: 'nr-reporter@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'nr-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const recipeReport = await seedReport({ recipeId: id, reporterId })

    const res = await removeReview(recipeReport, { reason: 'x' }, curador)
    expect(res.status).toBe(422)
    await expect(res.json()).resolves.toMatchObject({ error: 'sem_avaliacao' })
    expect((await readReport(recipeReport)).status).toBe('pending')

    // report inexistente ⇒ 404
    expect((await removeReview('00000000-0000-0000-0000-000000000000', { reason: 'x' }, curador)).status).toBe(404)
    expect((await removeReview('not-a-uuid', { reason: 'x' }, curador)).status).toBe(404)
  })

  // ── M2: "Manter" é o único descarte de um report de avaliação; remove/remove-image ⇒ 404 ──
  it('M2 keep num report de avaliação ⇒ rejected e avaliação INTOCADA; remove/remove-image nele ⇒ 404', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'm2-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'm2-reviewer@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'm2-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 4, comment: 'boa' })
    const rep = await seedReport({ reviewId, reporterId: reviewerId, reason: 'frívolo' })

    // keep (single-table) resolve como rejected e NÃO toca a avaliação
    const k = await keep(rep, curador)
    expect(k.status).toBe(200)
    expect((await readReport(rep)).status).toBe('rejected')
    const rev = await readReview(reviewId)
    expect(rev.moderatedAt).toBeNull() // avaliação intocada
    const list = (await (await getReviews(id)).json()) as ListBody
    expect(list.count).toBe(1) // ainda pública

    // remove / remove-image sobre um report de AVALIAÇÃO ⇒ 404 (INNER JOIN recipe dropa recipeId null)
    const rep2 = await seedReport({ reviewId, reporterId: reviewerId, reason: 'de novo' })
    expect((await removeRecipe(rep2, { reason: 'x' }, curador)).status).toBe(404)
    expect((await removeImage(rep2, { reason: 'x' }, curador)).status).toBe(404)
    expect((await readReport(rep2)).status).toBe('pending') // nenhum efeito
    expect((await readReview(reviewId)).moderatedAt).toBeNull()
  })

  // ── M4: evasão delete-and-repost bloqueada — a moderação é DURÁVEL ─────────────────
  it('M4 delete-and-repost: apagar a avaliação moderada é NO-OP; re-postar não ressuscita', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'm4-owner@ex.com' })
    const { userId: aId, headers: aH } = await seedSessionHeaders({ email: 'm4-a@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'm4-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)

    // autor A avalia via rota (upsert path), depois é moderada
    expect((await postReview(id, { rating: 5, comment: 'orig' }, aH)).status).toBe(200)
    const reviewId = await reviewIdOf(aId, id)
    const rep = await seedReport({ reviewId, reporterId: owner, reason: 'x' })
    expect((await removeReview(rep, { reason: 'removida' }, curador)).status).toBe(200)
    expect(((await (await getReviews(id)).json()) as ListBody).count).toBe(0) // some do público

    // autor tenta APAGAR ⇒ 200 (rota), mas é NO-OP: a linha moderada PERSISTE e segue oculta
    expect((await deleteReview(id, aH)).status).toBe(200)
    let rev = await readReview(reviewId)
    expect(rev).toBeDefined()
    expect(rev.moderatedAt).not.toBeNull()
    expect(((await (await getReviews(id)).json()) as ListBody).count).toBe(0)

    // autor RE-POSTA ⇒ upsert edita nota/comentário mas NÃO toca moderated_* ⇒ segue oculta
    expect((await postReview(id, { rating: 3, comment: 'de novo' }, aH)).status).toBe(200)
    rev = await readReview(reviewId)
    expect(rev.moderatedAt).not.toBeNull() // ainda moderada
    expect(rev.rating).toBe(3) // conteúdo editado
    expect(((await (await getReviews(id)).json()) as ListBody).count).toBe(0) // ainda oculta
  })

  // ── M6: loadViewerReview NÃO filtra moderatedAt — o autor vê a própria moderada ────
  it('M6 loadViewerReview: o autor de uma avaliação moderada ainda a recebe; editar mantém moderada; apagar é no-op', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'm6-owner@ex.com' })
    const { userId: aId, headers: aH } = await seedSessionHeaders({ email: 'm6-a@ex.com' })
    const { headers: curador } = await seedSessionHeaders({ email: 'm6-cur@ex.com', role: 'curador' })
    const id = await seedPublicCommunity(owner)
    expect((await postReview(id, { rating: 4, comment: 'minha' }, aH)).status).toBe(200)
    const reviewId = await reviewIdOf(aId, id)
    const rep = await seedReport({ reviewId, reporterId: owner, reason: 'x' })
    expect((await removeReview(rep, { reason: 'removida' }, curador)).status).toBe(200)

    // autor ainda vê a PRÓPRIA avaliação moderada (mine não filtra moderatedAt)
    const mine = await getMine(id, aH)
    expect(mine.status).toBe(200)
    const mineBody = (await mine.json()) as { viewerReview: { id: string; rating: number } | null; isOwner: boolean }
    expect(mineBody.viewerReview).not.toBeNull()
    expect(mineBody.viewerReview?.id).toBe(reviewId)
    expect(mineBody.isOwner).toBe(false)

    // editar mantém moderada
    expect((await postReview(id, { rating: 2 }, aH)).status).toBe(200)
    expect((await readReview(reviewId)).moderatedAt).not.toBeNull()

    // apagar é no-op
    expect((await deleteReview(id, aH)).status).toBe(200)
    expect((await readReview(reviewId)).moderatedAt).not.toBeNull()
  })

  // ── CHECK de consistência de moderação (espelha recipe/recipe_image) ──────────────
  it('CHECK recipe_review_moderation_consistency_chk rejeita moderated_at sem moderated_by (e vice-versa)', async () => {
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'chk-reviewer@ex.com' })
    const owner = (await seedSessionHeaders({ email: 'chk-owner@ex.com' })).userId
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 3 })

    let err: unknown
    try {
      await sql`UPDATE recipe_review SET moderated_at = now() WHERE id = ${reviewId}`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // moderated_at setado, moderated_by NULL ⇒ 23514

    err = undefined
    try {
      await sql`UPDATE recipe_review SET moderated_by = ${owner} WHERE id = ${reviewId}`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // moderated_by setado, moderated_at NULL ⇒ 23514
  })

  // ── CHECK de alvo XOR: exatamente um de recipe_id / review_id ─────────────────────
  it('CHECK report_target_chk rejeita ambos os alvos setados E ambos nulos', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'tgt-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'tgt-reviewer@ex.com' })
    const id = await seedPublicCommunity(owner)
    const reviewId = await seedReview({ userId: reviewerId, recipeId: id, rating: 3 })

    let err: unknown
    try {
      await sql`INSERT INTO report (recipe_id, review_id, reporter_id, reason) VALUES (${id}, ${reviewId}, ${reviewerId}, 'x')`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // ambos setados ⇒ CHECK viola

    err = undefined
    try {
      await sql`INSERT INTO report (reporter_id, reason) VALUES (${reviewerId}, 'x')`
    } catch (e) {
      err = e
    }
    expect(err).toBeTruthy() // ambos nulos ⇒ CHECK viola
  })

  // ── M1/M3: fila mista — review-target com conteúdo + recipe-target intacto ─────────
  it('M1/M3 listReportQueue: review-target traz conteúdo; recipe-target segue com origin/ownerImageGenBlocked', async () => {
    const { userId: owner } = await seedSessionHeaders({ email: 'q-owner@ex.com' })
    const { userId: reviewerId } = await seedSessionHeaders({ email: 'q-reviewer@ex.com' })
    const { userId: otherId } = await seedSessionHeaders({ email: 'q-reporter@ex.com' })
    const recId = await seedPublicCommunity(owner, 'Bolo reportado')
    // dono bloqueado na geração (M1: ownerImageGenBlocked derivado deve continuar presente). O CHECK
    // `users_image_gen_block_consistency_chk` exige `image_gen_blocked_at` E `image_gen_blocked_by` juntos.
    await getDb()
      .update(users)
      .set({ imageGenBlockedAt: new Date(), imageGenBlockedBy: otherId })
      .where(eq(users.id, owner))
    const reviewId = await seedReview({ userId: reviewerId, recipeId: recId, rating: 5, comment: 'texto da avaliação' })

    const recipeReport = await seedReport({ recipeId: recId, reporterId: otherId, reason: 'motivo receita' })
    const reviewReport = await seedReport({ reviewId, reporterId: otherId, reason: 'motivo avaliação' })

    const queue = await listReportQueue(getDb())
    const ids = queue.map((q) => q.id)
    // LEFT JOIN não dropa nenhum: os DOIS aparecem
    expect(ids).toContain(recipeReport)
    expect(ids).toContain(reviewReport)

    const recItem = queue.find((q) => q.id === recipeReport)!
    expect(recItem.target).toBe('recipe')
    if (recItem.target === 'recipe') {
      expect(recItem.recipeId).toBe(recId)
      expect(recItem.origin).toBe('ai_chat')
      expect(recItem.resultKind).toBe('success')
      expect(recItem.ownerId).toBe(owner)
      expect(recItem.ownerImageGenBlocked).toBe(true) // M1 regression guard
    }

    const revItem = queue.find((q) => q.id === reviewReport)!
    expect(revItem.target).toBe('review')
    if (revItem.target === 'review') {
      expect(revItem.reason).toBe('motivo avaliação')
      expect(revItem.review.id).toBe(reviewId)
      expect(revItem.review.recipeId).toBe(recId)
      expect(revItem.review.rating).toBe(5)
      expect(revItem.review.comment).toBe('texto da avaliação')
      expect(revItem.review.authorName).toBe('q-reviewer@ex.com') // seedUser name = email
    }
  })
})
