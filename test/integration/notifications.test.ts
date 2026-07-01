import { describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { POST as followPOST, DELETE as followDELETE } from '@/app/api/u/[handle]/follow/route'
import { getDb } from '@/server/deps'
import type { Database } from '@/db/client'
import { notification, users, vocabularyTerm } from '@/db/schema'
import {
  emitNotification,
  loadNotifications,
  markRead,
  NOTIFICATIONS_PAGE_SIZE,
} from '@/server/notification'
import { approveCozinha, mergeCozinha, rejectCozinha } from '@/server/vocabulary/curate'
import { applyModerationRemove, applyImageModeration } from '@/server/recipe/moderation'
import { setImageGenRestriction } from '@/server/curate/restriction'
import type { NotificationType } from '@/domain/notification'
import { seedUser, seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedRecipeImage, seedReport } from '../helpers/recipes'

/**
 * Caixa de Notificações (#371, ADR-0028) contra Postgres real. Cobre: o fio do emit (`new_follower` no
 * seguir, nunca no unfollow; uma por evento), o best-effort, `loadNotifications` (anti-IDOR, contador,
 * cursor lossless, degradação TOTAL do ator soft-deletado) e `markRead` (lote/por-item/uuid-forjado/
 * idempotente/anti-IDOR).
 */

function followReq(method: 'POST' | 'DELETE', handle: string, headers?: Headers) {
  const req = new Request(`http://localhost/api/u/${handle}/follow`, {
    method,
    headers: headers ?? new Headers(),
  })
  const ctx = { params: Promise.resolve({ handle }) }
  return method === 'POST' ? followPOST(req, ctx) : followDELETE(req, ctx)
}

async function handleOf(userId: string): Promise<string> {
  const [row] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
  return row!.handle
}

async function countNotifs(recipientId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.recipientId, recipientId))
  return rows.length
}

describe('emit new_follower (#371) — fio do seguir', () => {
  it('POST /follow insere UMA notificação (recipient=followee, actor=follower, type=new_follower)', async () => {
    const followee = await seedUser({ email: 'ee@n.test', name: 'Ee', handle: 'ee-notif' })
    const { userId: follower, headers } = await seedSessionHeaders({ email: 'er@n.test' })

    const res = await followReq('POST', 'ee-notif', headers)
    expect(res.status).toBe(200)

    const rows = await getDb().select().from(notification).where(eq(notification.recipientId, followee))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'new_follower', actorId: follower, recipeId: null, reviewId: null })
    expect(rows[0].readAt).toBeNull()
  })

  it('unfollow (DELETE) NÃO emite notificação', async () => {
    const followee = await seedUser({ email: 'ee2@n.test', name: 'Ee2', handle: 'ee2-notif' })
    const { headers } = await seedSessionHeaders({ email: 'er2@n.test' })
    await followReq('POST', 'ee2-notif', headers)
    await followReq('DELETE', 'ee2-notif', headers)
    // Só a do seguir; o unfollow não acrescenta nada.
    expect(await countNotifs(followee)).toBe(1)
  })

  it('re-seguir / double-POST → exatamente UMA notificação (uma por evento, ADR-0028)', async () => {
    const followee = await seedUser({ email: 'ee3@n.test', name: 'Ee3', handle: 'ee3-notif' })
    const { headers } = await seedSessionHeaders({ email: 'er3@n.test' })
    await followReq('POST', 'ee3-notif', headers) // aresta nova → 1
    await followReq('POST', 'ee3-notif', headers) // já segue → no-op, sem 2ª
    expect(await countNotifs(followee)).toBe(1)

    // unfollow + refollow: nova aresta nasce ⇒ nova notificação (evento genuíno), total 2.
    await followReq('DELETE', 'ee3-notif', headers)
    await followReq('POST', 'ee3-notif', headers)
    expect(await countNotifs(followee)).toBe(2)
  })

  it('auto-seguir (422) NÃO emite', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'self@n.test' })
    const h = await handleOf(userId)
    const res = await followReq('POST', h, headers)
    expect(res.status).toBe(422)
    expect(await countNotifs(userId)).toBe(0)
  })
})

describe('emitNotification (#371) — best-effort', () => {
  it('engole falha de insert e NÃO relança (a ação de origem nunca falha)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Stub que rejeita no insert — determinístico (não depende de violação de FK coincidental).
    const brokenDb = {
      insert: () => ({ values: () => Promise.reject(new Error('boom')) }),
    } as unknown as Database
    await expect(
      emitNotification(brokenDb, { recipientId: crypto.randomUUID(), type: 'new_follower' }),
    ).resolves.toBeUndefined()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})

describe('loadNotifications (#371) — leitura', () => {
  it('só do próprio recipient (anti-IDOR): viewer B nunca vê a linha de A', async () => {
    const a = await seedUser({ email: 'reca@n.test', name: 'RecA', handle: 'reca' })
    const b = await seedUser({ email: 'recb@n.test', name: 'RecB', handle: 'recb' })
    const actor = await seedUser({ email: 'act@n.test', name: 'Actor', handle: 'act1' })
    await emitNotification(getDb(), { recipientId: a, type: 'new_follower', actorId: actor })

    const pageA = await loadNotifications(getDb(), a)
    expect(pageA.notifications).toHaveLength(1)
    expect(pageA.unreadCount).toBe(1)
    expect(pageA.notifications[0]).toMatchObject({
      type: 'new_follower',
      refs: { actorName: 'Actor', actorHandle: 'act1' },
    })

    const pageB = await loadNotifications(getDb(), b)
    expect(pageB.notifications).toHaveLength(0)
    expect(pageB.unreadCount).toBe(0)
  })

  it('paginação por cursor lossless: probe limit+1, nextCursor, boundary de mesmo created_at', async () => {
    const rec = await seedUser({ email: 'pag@n.test', name: 'Pag', handle: 'pag' })
    const actor = await seedUser({ email: 'pact@n.test', name: 'PActor', handle: 'pact' })
    // 3 linhas com o MESMO created_at (boundary): o desempate por id garante ordem estável sem
    // repetir/omitir na virada de página.
    const ts = new Date('2026-01-01T00:00:00.000Z')
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const [row] = await getDb()
        .insert(notification)
        .values({ recipientId: rec, type: 'new_follower', actorId: actor, createdAt: ts })
        .returning({ id: notification.id })
      ids.push(row.id)
    }
    const p1 = await loadNotifications(getDb(), rec, { limit: 2 })
    expect(p1.notifications).toHaveLength(2)
    expect(p1.nextCursor).not.toBeNull()
    const p2 = await loadNotifications(getDb(), rec, { limit: 2, cursor: p1.nextCursor })
    expect(p2.notifications).toHaveLength(1)
    expect(p2.nextCursor).toBeNull()
    // As 3 linhas, sem repetição nem omissão no boundary de created_at igual.
    const seen = [...p1.notifications, ...p2.notifications].map((n) => n.id)
    expect(new Set(seen).size).toBe(3)
    expect(seen.sort()).toEqual([...ids].sort())
  })

  it('default page size = NOTIFICATIONS_PAGE_SIZE', () => {
    expect(NOTIFICATIONS_PAGE_SIZE).toBe(20)
  })

  it('degradação TOTAL: ator soft-deletado → actorName/actorHandle/actorImage TODOS null, linha PERMANECE', async () => {
    const rec = await seedUser({ email: 'deg@n.test', name: 'Deg', handle: 'deg' })
    const actor = await seedUser({
      email: 'gone@n.test',
      name: 'Gone',
      handle: 'gone-actor',
    })
    await getDb().update(users).set({ image: 'https://img.test/a.png' }).where(eq(users.id, actor))
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })

    // vivo: identidade presente
    const alive = await loadNotifications(getDb(), rec)
    expect(alive.notifications[0]).toMatchObject({
      refs: { actorName: 'Gone', actorHandle: 'gone-actor' },
      actorImage: 'https://img.test/a.png',
    })

    // soft-delete do ator → identidade COLAPSA junta, mas a notificação NÃO some.
    await getDb().update(users).set({ deletedAt: new Date() }).where(eq(users.id, actor))
    const degraded = await loadNotifications(getDb(), rec)
    expect(degraded.notifications).toHaveLength(1)
    expect(degraded.notifications[0].refs.actorName).toBeNull()
    expect(degraded.notifications[0].refs.actorHandle).toBeNull()
    expect(degraded.notifications[0].actorImage).toBeNull()
  })
})

describe('markRead (#371)', () => {
  it('marca-tudo (ids ausente) zera o contador; idempotente', async () => {
    const rec = await seedUser({ email: 'mr1@n.test', name: 'Mr1', handle: 'mr1' })
    const actor = await seedUser({ email: 'mra@n.test', name: 'MrA', handle: 'mra' })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    expect((await loadNotifications(getDb(), rec)).unreadCount).toBe(2)

    expect((await markRead(getDb(), rec)).unreadCount).toBe(0)
    expect((await markRead(getDb(), rec)).unreadCount).toBe(0) // idempotente
  })

  it('por-id marca só a indicada; as outras seguem não-lidas', async () => {
    const rec = await seedUser({ email: 'mr2@n.test', name: 'Mr2', handle: 'mr2' })
    const actor = await seedUser({ email: 'mra2@n.test', name: 'MrA2', handle: 'mra2' })
    const [a] = await getDb()
      .insert(notification)
      .values({ recipientId: rec, type: 'new_follower', actorId: actor })
      .returning({ id: notification.id })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })

    const r = await markRead(getDb(), rec, { ids: [a.id] })
    expect(r.unreadCount).toBe(1)
  })

  it('ids com UUID forjado/inválido → sem 500; filtrado-vazio é NO-OP (nunca marca-tudo)', async () => {
    const rec = await seedUser({ email: 'mr3@n.test', name: 'Mr3', handle: 'mr3' })
    const actor = await seedUser({ email: 'mra3@n.test', name: 'MrA3', handle: 'mra3' })
    await emitNotification(getDb(), { recipientId: rec, type: 'new_follower', actorId: actor })
    // `ids` presente mas só lixo → NO-OP: o contador NÃO cai (não vira marca-tudo).
    const r = await markRead(getDb(), rec, { ids: ["not-a-uuid", "1; drop table", ""] })
    expect(r.unreadCount).toBe(1)
  })

  it('anti-IDOR: B não marca a notificação de A', async () => {
    const a = await seedUser({ email: 'mia@n.test', name: 'MiA', handle: 'mia' })
    const b = await seedUser({ email: 'mib@n.test', name: 'MiB', handle: 'mib' })
    const actor = await seedUser({ email: 'miact@n.test', name: 'MiAct', handle: 'miact' })
    const [n] = await getDb()
      .insert(notification)
      .values({ recipientId: a, type: 'new_follower', actorId: actor })
      .returning({ id: notification.id })
    // B tenta marcar a linha de A pelo id → não afeta (WHERE recipient_id = B).
    await markRead(getDb(), b, { ids: [n.id] })
    const stillUnread = await getDb()
      .select({ id: notification.id })
      .from(notification)
      .where(and(eq(notification.recipientId, a), eq(notification.id, n.id)))
    expect((await loadNotifications(getDb(), a)).unreadCount).toBe(1)
    expect(stillUnread).toHaveLength(1)
  })
})

/**
 * Eventos N2 de curadoria/moderação (#373, ADR-0028) contra Postgres real. Prova cada fio de emit:
 * fan-out de cozinha por sugeridor DISTINTO (approve/merge/reject; catálogo owner-null nunca notifica),
 * `recipe_moderated`/`image_moderated` pro dono (só na 1ª ação genuína), `account_restricted` pro alvo
 * (só no bloqueio recém-aplicado), e o best-effort (a ação SUCEDE mesmo se o insert da notificação falha).
 * Todas as 4 são impessoais: `actor_id` NULL (nenhum ator interpolado no render).
 */

/** Insere um termo de cozinha `suggested` (FK-primeiro: precede qualquer recipe.cozinha=slug). */
async function seedSuggestedCozinha(slug: string): Promise<void> {
  await getDb().insert(vocabularyTerm).values({ kind: 'cozinha', slug, status: 'suggested' })
}

/** Linhas cruas de notificação de um recipient (type/actorId/recipeId/reviewId p/ toMatchObject). */
async function notifsFor(recipientId: string) {
  return getDb().select().from(notification).where(eq(notification.recipientId, recipientId))
}

async function countByType(type: NotificationType): Promise<number> {
  const rows = await getDb()
    .select({ id: notification.id })
    .from(notification)
    .where(eq(notification.type, type))
  return rows.length
}

describe('emit cuisine_suggestion_resolved (#373) — fan-out por sugeridor DISTINTO', () => {
  it('approve: donos distintos → 1 notif cada (dedup por dono); catálogo (owner null) → 0', async () => {
    await seedSuggestedCozinha('georgiana')
    const o1 = await seedUser({ email: 'cz-o1@n.test' })
    const o2 = await seedUser({ email: 'cz-o2@n.test' })
    // duas receitas do MESMO dono o1 → uma notificação só (SELECT DISTINTO por owner_id).
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o2, cozinha: 'georgiana' })
    // catálogo (owner null) anexado ao slug → NÃO tem destinatário.
    await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha: 'georgiana' })

    const res = await approveCozinha(getDb(), {
      slug: 'georgiana',
      labelPtBr: 'Georgiana',
      labelEnUs: 'Georgian',
    })
    expect(res.ok).toBe(true)

    const r1 = await notifsFor(o1)
    expect(r1).toHaveLength(1)
    expect(r1[0]).toMatchObject({
      type: 'cuisine_suggestion_resolved',
      actorId: null,
      recipeId: null,
      reviewId: null,
    })
    expect(await notifsFor(o2)).toHaveLength(1)
    // EXATAMENTE 2 no total: uma por dono distinto, zero pro catálogo.
    expect(await countByType('cuisine_suggestion_resolved')).toBe(2)
  })

  it('merge: reaponta pra ativa e notifica os donos (1 por dono)', async () => {
    await seedSuggestedCozinha('georgiana')
    const o1 = await seedUser({ email: 'czm-o1@n.test' })
    const o2 = await seedUser({ email: 'czm-o2@n.test' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o2, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha: 'georgiana' })

    const res = await mergeCozinha(getDb(), { slug: 'georgiana', target: 'italiana' })
    expect(res.ok).toBe(true)
    expect(await notifsFor(o1)).toHaveLength(1)
    expect(await notifsFor(o2)).toHaveLength(1)
    expect(await countByType('cuisine_suggestion_resolved')).toBe(2)
  })

  it('reject: anula recipe.cozinha e notifica os donos (captura ANTES de anular)', async () => {
    await seedSuggestedCozinha('georgiana')
    const o1 = await seedUser({ email: 'czr-o1@n.test' })
    const o2 = await seedUser({ email: 'czr-o2@n.test' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o2, cozinha: 'georgiana' })

    const res = await rejectCozinha(getDb(), { slug: 'georgiana' })
    expect(res.ok).toBe(true)
    // Os donos foram capturados ANTES do UPDATE que anula cozinha → NULL.
    expect(await notifsFor(o1)).toHaveLength(1)
    expect(await notifsFor(o2)).toHaveLength(1)
    expect(await countByType('cuisine_suggestion_resolved')).toBe(2)
  })

  it('erro (ja_resolvido) → 0 notificações', async () => {
    await seedSuggestedCozinha('georgiana')
    const o1 = await seedUser({ email: 'cze-o1@n.test' })
    await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId: o1, cozinha: 'georgiana' })
    // 1ª aprovação resolve; a 2ª cai em ja_resolvido (não emite).
    await approveCozinha(getDb(), { slug: 'georgiana', labelPtBr: 'G', labelEnUs: 'G' })
    const again = await approveCozinha(getDb(), { slug: 'georgiana', labelPtBr: 'G', labelEnUs: 'G' })
    expect(again.ok).toBe(false)
    expect(await notifsFor(o1)).toHaveLength(1) // só a da 1ª; a 2ª não re-notifica
  })
})

describe('emit recipe_moderated (#373) — remoção do pool → dono', () => {
  it('1ª remoção → 1 notif pro dono (recipeId setado); 2ª (ok_already_removed) não re-notifica', async () => {
    const owner = await seedUser({ email: 'rm-o@n.test' })
    const curator = await seedUser({ email: 'rm-c@n.test', role: 'curador' })
    const reporter = await seedUser({ email: 'rm-r@n.test' })
    const rid = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner,
    })
    const rep1 = await seedReport({ recipeId: rid, reporterId: reporter })

    const res = await applyModerationRemove({
      db: getDb(),
      reportId: rep1,
      curatorId: curator,
      reason: 'conteúdo impróprio',
    })
    expect(res.kind).toBe('ok')
    const rows = await notifsFor(owner)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'recipe_moderated', actorId: null, recipeId: rid })

    // 2ª remoção (outro report) → ok_already_removed → NÃO emite 2ª.
    const rep2 = await seedReport({ recipeId: rid, reporterId: reporter })
    const res2 = await applyModerationRemove({
      db: getDb(),
      reportId: rep2,
      curatorId: curator,
      reason: 'de novo',
    })
    expect(res2.kind).toBe('ok_already_removed')
    expect(await notifsFor(owner)).toHaveLength(1)
  })

  it('catálogo (owner null) → 0 notificações', async () => {
    const curator = await seedUser({ email: 'rmc-c@n.test', role: 'curador' })
    const reporter = await seedUser({ email: 'rmc-r@n.test' })
    const rid = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const rep = await seedReport({ recipeId: rid, reporterId: reporter })
    const res = await applyModerationRemove({
      db: getDb(),
      reportId: rep,
      curatorId: curator,
      reason: 'x',
    })
    expect(res.kind).toBe('ok')
    expect(await countByType('recipe_moderated')).toBe(0)
  })
})

describe('emit image_moderated (#373) — moderação de imagem → dono da receita', () => {
  it('modera imagem → 1 notif pro dono da receita (recipeId setado)', async () => {
    const owner = await seedUser({ email: 'im-o@n.test' })
    const curator = await seedUser({ email: 'im-c@n.test', role: 'curador' })
    const reporter = await seedUser({ email: 'im-r@n.test' })
    const rid = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      ownerId: owner,
    })
    await seedRecipeImage({ recipeId: rid })
    const rep = await seedReport({ recipeId: rid, reporterId: reporter })

    const res = await applyImageModeration({
      db: getDb(),
      reportId: rep,
      curatorId: curator,
      reason: 'imagem imprópria',
    })
    expect(res.kind).toBe('ok')
    const rows = await notifsFor(owner)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'image_moderated', actorId: null, recipeId: rid })
  })
})

describe('emit account_restricted (#373) — bloqueio de geração → usuário restrito', () => {
  it('bloqueio → 1 notif pro alvo; re-block já-bloqueado → 0; unblock → 0', async () => {
    const target = await seedUser({ email: 'ar-t@n.test' })
    const curator = await seedUser({ email: 'ar-c@n.test', role: 'curador' })

    const blocked = await setImageGenRestriction({
      db: getDb(),
      curatorId: curator,
      targetUserId: target,
      blocked: true,
      reason: 'abuso confirmado',
    })
    expect(blocked.kind).toBe('ok')
    const rows = await notifsFor(target)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'account_restricted',
      actorId: null,
      recipeId: null,
      reviewId: null,
    })

    // re-block já-bloqueado → ok_already_blocked → NÃO emite 2ª.
    const again = await setImageGenRestriction({
      db: getDb(),
      curatorId: curator,
      targetUserId: target,
      blocked: true,
      reason: 'abuso 2',
    })
    expect(again.kind).toBe('ok_already_blocked')
    expect(await notifsFor(target)).toHaveLength(1)

    // desbloquear → NÃO emite.
    const unblocked = await setImageGenRestriction({
      db: getDb(),
      curatorId: curator,
      targetUserId: target,
      blocked: false,
    })
    expect(unblocked.kind).toBe('ok')
    expect(await notifsFor(target)).toHaveLength(1)
  })

  it('best-effort: o bloqueio SUCEDE mesmo se o insert da notificação falhar (engolido)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const target = await seedUser({ email: 'be-t@n.test' })
    const curator = await seedUser({ email: 'be-c@n.test', role: 'curador' })
    // db cujo `insert` (usado só pelo emit pós-commit) rejeita; `transaction`/`select`/`update`
    // delegam ao db real (Object.create) → a AÇÃO roda normal, só a notificação falha.
    const realDb = getDb()
    const flakyDb = Object.assign(Object.create(realDb), {
      insert: () => ({ values: () => Promise.reject(new Error('boom')) }),
    }) as Database

    const res = await setImageGenRestriction({
      db: flakyDb,
      curatorId: curator,
      targetUserId: target,
      blocked: true,
      reason: 'abuso',
    })
    expect(res.kind).toBe('ok') // a ação NÃO falhou

    // O bloqueio PERSISTIU (lido pelo db real).
    const [u] = await getDb()
      .select({ blockedAt: users.imageGenBlockedAt })
      .from(users)
      .where(eq(users.id, target))
    expect(u.blockedAt).not.toBeNull()
    // Nenhuma notificação criada (insert engolido).
    expect(await notifsFor(target)).toHaveLength(0)
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
