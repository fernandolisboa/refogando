import { describe, expect, it } from 'vitest'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { POST } from '@/app/api/me/erasure/route'
import { GET as GET_ME } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { account, dsarAuditEvent, mealPlanEntry, pantryItem, recipe, recipeReview, session, users, verification } from '@/db/schema'
import { erasedIdentity } from '@/domain/account-erasure'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedReview } from '../helpers/recipes'

/**
 * Eliminação self-service da própria conta (#401, GAP-6; #473, ADR-0049; LGPD Art. 18 VI + Art. 16).
 * Contrato de `POST /api/me/erasure`: anonimiza a PII + bloqueia (deletedAt) + carimba (anonymizedAt) +
 * desloga (apaga sessões) + remove credenciais (apaga account e os tokens de verification) + APAGA o
 * conteúdo PRIVADO + audita; MANTÉM o conteúdo PÚBLICO (Receitas públicas e avaliações, anonimizadas).
 * Só-titular (sessão), confirmação obrigatória. O conteúdo privado em detalhe (imagens, sessões de
 * criação, social, falhas) está em `account-erasure-private-content.test.ts`.
 */

function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/me/erasure', {
      method: 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
}

async function readUser(id: string) {
  const [row] = await getDb()
    .select({
      email: users.email,
      name: users.name,
      handle: users.handle,
      image: users.image,
      bio: users.bio,
      links: users.links,
      locale: users.locale,
      deletedAt: users.deletedAt,
      anonymizedAt: users.anonymizedAt,
    })
    .from(users)
    .where(eq(users.id, id))
  return row
}

async function countSessions(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(session)
    .where(eq(session.userId, userId))
  return row?.n ?? 0
}

async function countAccounts(userId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(account)
    .where(eq(account.userId, userId))
  return row?.n ?? 0
}

async function countVerificationsFor(email: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(verification)
    .where(eq(verification.identifier, email))
  return row?.n ?? 0
}

describe('/api/me/erasure — eliminação conservadora do titular (#401)', () => {
  it('sem sessão (Visitante) → 401 nao_autenticado (zero efeito)', async () => {
    const res = await post({ confirm: true })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('sem confirmação → 400 confirmacao_necessaria (não elimina)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'semconfirma@erasure.test' })

    const res = await post({}, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'confirmacao_necessaria' })

    // Nada mudou: PII intacta, conta ativa.
    const u = await readUser(userId)
    expect(u.email).toBe('semconfirma@erasure.test')
    expect(u.deletedAt).toBeNull()
    expect(u.anonymizedAt).toBeNull()
  })

  it('confirmada: anonimiza PII + bloqueia + carimba + desloga + apaga credenciais + audita; MANTÉM o conteúdo PÚBLICO e APAGA o privado', async () => {
    const { userId, headers } = await seedSessionHeaders({
      email: 'vai-sair@erasure.test',
      locale: 'pt-BR',
    })
    // Perfil com PII preenchida.
    await getDb()
      .update(users)
      .set({ name: 'Maria', bio: 'minha bio', image: 'https://x/a.png' })
      .where(eq(users.id, userId))
    // Uma credencial (account) e uma sessão explícita no DB.
    await getDb()
      .insert(account)
      .values({ userId, accountId: userId, providerId: 'credential', password: 'hash' })
    await getDb()
      .insert(session)
      .values({ userId, token: `tok-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) })
    // Conteúdo do titular: uma receita própria pública, uma privada + uma avaliação.
    const ownRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'public',
    })
    const privateRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
    })
    const otherRecipe = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const reviewId = await seedReview({ userId, recipeId: otherRecipe, rating: 4, comment: 'boa' })

    expect(await countSessions(userId)).toBeGreaterThanOrEqual(1)
    expect(await countAccounts(userId)).toBe(1)

    const res = await post({ confirm: true }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, alreadyErased: false })

    // PII anonimizada de forma estável + conta bloqueada/carimbada.
    const anon = erasedIdentity(userId)
    const u = await readUser(userId)
    expect(u.email).toBe(anon.email)
    expect(u.email).not.toContain('vai-sair@erasure.test')
    expect(u.name).toBe('Usuário removido')
    expect(u.handle).toBe(anon.handle)
    expect(u.image).toBeNull()
    expect(u.bio).toBeNull()
    expect(u.links).toEqual([])
    expect(u.locale).toBeNull()
    expect(u.deletedAt).not.toBeNull()
    expect(u.anonymizedAt).not.toBeNull()

    // Deslogado/credenciais removidas.
    expect(await countSessions(userId)).toBe(0)
    expect(await countAccounts(userId)).toBe(0)

    // Conteúdo PÚBLICO mantido: a receita pública segue existindo com o mesmo owner_id (anonimizado) e a
    // avaliação fica (terceiros dependem dela). A receita PRIVADA saiu (#473).
    const [r] = await getDb()
      .select({ ownerId: recipe.ownerId })
      .from(recipe)
      .where(eq(recipe.id, ownRecipe))
    expect(r.ownerId).toBe(userId)
    expect(await getDb().select({ id: recipe.id }).from(recipe).where(eq(recipe.id, privateRecipe))).toEqual([])
    const [rev] = await getDb()
      .select({ id: recipeReview.id })
      .from(recipeReview)
      .where(eq(recipeReview.id, reviewId))
    expect(rev.id).toBe(reviewId)

    // Auditoria DSAR (append-only): um DSAR_RECEIVED self-service de account_erasure do titular.
    const events = await getDb()
      .select({
        eventType: dsarAuditEvent.eventType,
        channel: dsarAuditEvent.channel,
        requestType: dsarAuditEvent.requestType,
        actorId: dsarAuditEvent.actorId,
      })
      .from(dsarAuditEvent)
      .where(eq(dsarAuditEvent.actorId, userId))
    expect(events).toEqual([
      {
        eventType: 'DSAR_RECEIVED',
        channel: 'self_service',
        requestType: 'account_erasure',
        actorId: userId,
      },
    ])

    // Logout de verdade: a sessão foi APAGADA (não só bloqueada), então a MESMA credencial já
    // não resolve nenhuma sessão → 401 nao_autenticado (o gate deletedAt é o backstop; aqui a
    // sessão nem existe mais). De qualquer forma o acesso está barrado (401).
    const meRes = await GET_ME(new Request('http://localhost/api/me', { headers }))
    expect(meRes.status).toBe(401)
    await expect(meRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    // A 2ª chamada com o mesmo cookie também: a sessão não existe mais (não é o `conta_desativada`).
    const again = await post({ confirm: true }, headers)
    expect(again.status).toBe(401)
    await expect(again.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('idempotente: re-eliminar a mesma conta é no-op (already_erased), sem 2º evento de auditoria', async () => {
    const userId = await seedUser({ email: 'idem@erasure.test' })

    const first = await eraseOwnAccount(getDb(), { userId })
    expect(first.kind).toBe('erased')

    const second = await eraseOwnAccount(getDb(), { userId })
    expect(second.kind).toBe('already_erased')

    const [{ n }] = await getDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(dsarAuditEvent)
      .where(and(eq(dsarAuditEvent.actorId, userId), eq(dsarAuditEvent.requestType, 'account_erasure')))
    expect(n).toBe(1)
  })

  it('expurga a PII residual em `verification` (e-mail real em claro), de forma idempotente', async () => {
    const email = 'reset-pendente@erasure.test'
    const userId = await seedUser({ email })
    // Simula um token de reset-de-senha / verificação-de-e-mail pendente: o `identifier` guarda o
    // e-mail REAL em claro. Sem o expurgo, essa linha sobreviveria à eliminação até expirar.
    await getDb().insert(verification).values({
      identifier: email,
      value: 'token-secreto',
      expiresAt: new Date(Date.now() + 3_600_000),
    })
    expect(await countVerificationsFor(email)).toBe(1)

    const first = await eraseOwnAccount(getDb(), { userId })
    expect(first.kind).toBe('erased')

    // (a) Nenhuma linha de verificação com o e-mail real sobrevive à eliminação.
    expect(await countVerificationsFor(email)).toBe(0)

    // (b) Idempotente: re-eliminar (email já é a sentinela) é no-op — não estoura nem re-apaga.
    const second = await eraseOwnAccount(getDb(), { userId })
    expect(second.kind).toBe('already_erased')
    expect(await countVerificationsFor(email)).toBe(0)
  })

  it('expurga os tokens de `verification` que guardam o id em `value` (link de senha), sem tocar os de outra conta', async () => {
    const a = await seedUser({ email: 'value-a@erasure.test' })
    const b = await seedUser({ email: 'value-b@erasure.test' })
    const expiresAt = new Date(Date.now() + 3_600_000)
    await getDb()
      .insert(verification)
      .values([
        { identifier: 'reset-password:token-de-a', value: a, expiresAt },
        { identifier: 'reset-password:token-de-b', value: b, expiresAt },
      ])

    expect((await eraseOwnAccount(getDb(), { userId: a })).kind).toBe('erased')

    const left = await getDb().select({ value: verification.value }).from(verification)
    expect(left).toEqual([{ value: b }])
  })

  it('apaga o Plano de refeições do titular (privado, ninguém depende) e não toca o de outra conta', async () => {
    const a = await seedUser({ email: 'plano-a@erasure.test' })
    const b = await seedUser({ email: 'plano-b@erasure.test' })
    const r = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    await getDb()
      .insert(mealPlanEntry)
      .values([
        { userId: a, day: '2026-09-28', slot: 'almoco', recipeId: r },
        { userId: b, day: '2026-09-28', slot: 'almoco', recipeId: r },
      ])

    expect((await eraseOwnAccount(getDb(), { userId: a })).kind).toBe('erased')

    expect(await getDb().select().from(mealPlanEntry).where(eq(mealPlanEntry.userId, a))).toEqual([])
    expect(await getDb().select().from(mealPlanEntry).where(eq(mealPlanEntry.userId, b))).toHaveLength(1)
  })

  it('apaga a Despensa do titular (ADR-0038) e os básicos dele (ADR-0042), sem tocar os de outra conta', async () => {
    const a = await seedUser({ email: 'despensa-a@erasure.test' })
    const b = await seedUser({ email: 'despensa-b@erasure.test' })
    await getDb()
      .insert(pantryItem)
      .values([
        { userId: a, nome: 'ovo', matchKey: 'ovo' },
        { userId: b, nome: 'ovo', matchKey: 'ovo' },
      ])
    await getDb().update(users).set({ pantryBasics: ['alho'] }).where(inArray(users.id, [a, b]))

    expect((await eraseOwnAccount(getDb(), { userId: a })).kind).toBe('erased')

    expect(await getDb().select().from(pantryItem).where(eq(pantryItem.userId, a))).toEqual([])
    expect(await getDb().select().from(pantryItem).where(eq(pantryItem.userId, b))).toHaveLength(1)
    const basics = async (id: string) =>
      (await getDb().select({ b: users.pantryBasics }).from(users).where(eq(users.id, id)))[0].b
    expect(await basics(a)).toBeNull()
    expect(await basics(b)).toEqual(['alho'])
  })

  it('não toca outra conta (sem IDOR): eliminar A preserva a PII de B', async () => {
    const { userId: a, headers } = await seedSessionHeaders({ email: 'a-idor@erasure.test' })
    const b = await seedUser({ email: 'b-idor@erasure.test', handle: 'b-intacto' })

    const res = await post({ confirm: true }, headers)
    expect(res.status).toBe(200)

    // B intacto.
    const ub = await readUser(b)
    expect(ub.email).toBe('b-idor@erasure.test')
    expect(ub.handle).toBe('b-intacto')
    expect(ub.deletedAt).toBeNull()
    expect(ub.anonymizedAt).toBeNull()
    // A eliminado.
    expect((await readUser(a)).deletedAt).not.toBeNull()
  })
})
