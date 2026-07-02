import { describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { POST } from '@/app/api/me/erasure/route'
import { GET as GET_ME } from '@/app/api/me/route'
import { getDb } from '@/server/deps'
import { account, dsarAuditEvent, recipe, recipeReview, session, users, verification } from '@/db/schema'
import { erasedIdentity } from '@/domain/account-erasure'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedReview } from '../helpers/recipes'

/**
 * Eliminação self-service da própria conta (#401, GAP-6; LGPD Art. 18 VI + Art. 16). Contrato de
 * `POST /api/me/erasure`: CONSERVADORA — anonimiza a PII + bloqueia (deletedAt) + carimba
 * (anonymizedAt) + desloga (apaga sessões) + remove credenciais (apaga account) + audita; MANTÉM o
 * conteúdo do titular (não hard-delete em cascata). Só-titular (sessão), confirmação obrigatória.
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

  it('confirmada: anonimiza PII + bloqueia + carimba + desloga + apaga credenciais + audita; MANTÉM conteúdo', async () => {
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
    // Conteúdo do titular: uma receita própria + uma avaliação.
    const ownRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'public',
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

    // Conteúdo MANTIDO (não hard-delete): receita própria segue existindo com o mesmo owner_id;
    // avaliação preservada (terceiros dependem dela).
    const [r] = await getDb()
      .select({ ownerId: recipe.ownerId })
      .from(recipe)
      .where(eq(recipe.id, ownRecipe))
    expect(r.ownerId).toBe(userId)
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
