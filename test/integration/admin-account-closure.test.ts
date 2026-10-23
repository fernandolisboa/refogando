import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { POST } from '@/app/api/admin/users/[id]/erasure/route'
import { getDb, setImageStore, setMailer } from '@/server/deps'
import { accountClosure, dsarAuditEvent, recipe, recipeReview, session, users } from '@/db/schema'
import { erasedIdentity } from '@/domain/account-erasure'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeMailer } from '@/server/mail/mailer'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import { enUS } from '@/i18n/messages/en-US'
import { ptBR } from '@/i18n/messages/pt-BR'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import { seedRecipe, seedRecipeImage, seedReview } from '../helpers/recipes'

/**
 * Encerramento de conta pela equipe (#606, ADR-0051 P1/P3) — `POST /api/admin/users/[id]/erasure` contra o Postgres
 * real. Guardas (mesma origem, admin, sessão recente), recusas (própria conta, admin, inexistente, já eliminada, @
 * errado, conteúdo público fora do menor de 16), o núcleo da eliminação (o mesmo do self-service), o registro em
 * `account_closure` sem dado pessoal e sem evento DSAR, o e-mail de encerramento (violação) e o caminho do menor de
 * 16 que remove as receitas públicas e as avaliações, com os blobs no `FakeImageStore`.
 */

let store: FakeImageStore
let mailer: FakeMailer

beforeEach(() => {
  store = new FakeImageStore()
  setImageStore(store)
  mailer = new FakeMailer()
  setMailer(mailer)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function post(id: string, body: unknown, headers?: Headers, extra: Record<string, string> = {}): Promise<Response> {
  const h = new Headers(headers)
  for (const [k, v] of Object.entries(extra)) h.set(k, v)
  return POST(
    new Request(`http://localhost/api/admin/users/${id}/erasure`, {
      method: 'POST',
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  )
}

async function admin() {
  return seedSessionHeaders({ email: 'admin@closure.test', role: 'admin' })
}

async function target(over: { email?: string; locale?: string | null; handle?: string; emailVerified?: boolean } = {}) {
  const email = over.email ?? 'alvo@closure.test'
  const handle = over.handle ?? 'alvo-conta'
  const id = await seedUser({
    email,
    name: 'Pessoa Alvo',
    handle,
    locale: over.locale ?? null,
    emailVerified: over.emailVerified ?? true,
  })
  return { id, email, handle }
}

async function readUser(id: string) {
  const [row] = await getDb()
    .select({ email: users.email, name: users.name, handle: users.handle, deletedAt: users.deletedAt, anonymizedAt: users.anonymizedAt })
    .from(users)
    .where(eq(users.id, id))
  return row
}

async function closures() {
  return getDb().select().from(accountClosure)
}

async function recipeExists(id: string): Promise<boolean> {
  return (await getDb().select({ id: recipe.id }).from(recipe).where(eq(recipe.id, id))).length > 0
}

async function reviewExists(id: string): Promise<boolean> {
  return (await getDb().select({ id: recipeReview.id }).from(recipeReview).where(eq(recipeReview.id, id))).length > 0
}

async function blob(pathPrefix: string): Promise<string> {
  return (await store.store({ data: Buffer.from('x'), contentType: 'image/webp', pathPrefix })).url
}

async function reviewWithPhoto(userId: string, recipeId: string, moderatedBy?: string): Promise<{ id: string; url: string }> {
  const id = await seedReview({ userId, recipeId, rating: 4, comment: 'boa', ...(moderatedBy ? { moderated: { curatorId: moderatedBy } } : {}) })
  const url = await blob('reviews')
  await getDb().update(recipeReview).set({ photoUrl: url }).where(eq(recipeReview.id, id))
  return { id, url }
}

describe('guardas', () => {
  it('sem sessão → 401; usuário e curador → 403 papel_insuficiente; nada muda', async () => {
    const t = await target()
    expect((await post(t.id, { reason: 'violacao_grave', confirmHandle: t.handle })).status).toBe(401)
    for (const role of ['usuario', 'curador'] as const) {
      const { headers } = await seedSessionHeaders({ email: `${role}@closure.test`, role })
      const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: t.handle }, headers)
      expect(res.status).toBe(403)
      await expect(res.json()).resolves.toEqual({ error: 'papel_insuficiente' })
    }
    expect((await readUser(t.id)).deletedAt).toBeNull()
  })

  it('outro site (Sec-Fetch-Site cross-site) → 403 origem_nao_permitida, antes da sessão', async () => {
    const { headers } = await admin()
    const t = await target()
    const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: t.handle }, headers, {
      'sec-fetch-site': 'cross-site',
    })
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'origem_nao_permitida' })
    expect((await readUser(t.id)).deletedAt).toBeNull()
  })

  it('sessão do admin com mais de 24 h → 403 reautenticar, nada é apagado', async () => {
    const { userId, headers } = await admin()
    await getDb()
      .update(session)
      .set({ createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where(eq(session.userId, userId))
    const t = await target()
    const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: t.handle }, headers)
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'reautenticar' })
    expect((await readUser(t.id)).deletedAt).toBeNull()
    expect(await closures()).toEqual([])
  })
})

describe('recusas (zero efeito)', () => {
  it('a própria conta → 400 conta_propria (id em maiúsculas também)', async () => {
    const { userId, headers } = await admin()
    const [me] = await getDb().select({ handle: users.handle }).from(users).where(eq(users.id, userId))
    const res = await post(userId.toUpperCase(), { reason: 'violacao_grave', confirmHandle: me.handle }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'conta_propria' })
    expect((await readUser(userId)).deletedAt).toBeNull()
  })

  it('conta de admin → 409 alvo_admin', async () => {
    const { headers } = await admin()
    const other = await seedUser({ email: 'outro-admin@closure.test', handle: 'outro-admin', role: 'admin' })
    const res = await post(other, { reason: 'violacao_grave', confirmHandle: 'outro-admin' }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'alvo_admin' })
    expect((await readUser(other)).deletedAt).toBeNull()
  })

  it('inexistente ou id que não é uuid → 404 not_found', async () => {
    const { headers } = await admin()
    const res = await post(crypto.randomUUID(), { reason: 'violacao_grave', confirmHandle: 'x' }, headers)
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'not_found' })
    expect((await post('nao-e-uuid', { reason: 'violacao_grave', confirmHandle: 'x' }, headers)).status).toBe(404)
  })

  it('já eliminada (ou desativada) → 409 conta_inativa, sem segundo registro', async () => {
    const { headers } = await admin()
    const t = await target()
    await eraseOwnAccount(getDb(), { userId: t.id })
    const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: erasedIdentity(t.id).handle }, headers)
    expect(res.status).toBe(409)
    await expect(res.json()).resolves.toEqual({ error: 'conta_inativa' })
    expect(await closures()).toEqual([])
  })

  it('@ digitado errado ou ausente → 400 confirmacao_invalida', async () => {
    const { headers } = await admin()
    const t = await target()
    for (const confirmHandle of ['outra-conta', '', undefined]) {
      const res = await post(t.id, { reason: 'violacao_grave', confirmHandle }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'confirmacao_invalida' })
    }
    expect((await readUser(t.id)).deletedAt).toBeNull()
  })

  it('corpo fora da forma → 400 dados_invalidos; remover o conteúdo público na violação → 400', async () => {
    const { headers } = await admin()
    const t = await target()
    for (const body of [undefined, {}, { reason: 'outro', confirmHandle: t.handle }, { reason: 'menor_16', removePublicContent: 'sim', confirmHandle: t.handle }]) {
      const res = await post(t.id, body, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'dados_invalidos' })
    }
    const res = await post(t.id, { reason: 'violacao_grave', removePublicContent: true, confirmHandle: t.handle }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'conteudo_publico_so_menor_16' })
    expect((await readUser(t.id)).deletedAt).toBeNull()
  })
})

describe('violação grave', () => {
  it('elimina pelo núcleo de sempre, registra sem dado pessoal (sem evento DSAR) e manda o e-mail no idioma da conta', async () => {
    const info = vi.spyOn(console, 'info')
    const { userId: adminId, headers } = await admin()
    const t = await target({ email: 'violou@closure.test', locale: 'en-US', handle: 'violou' })
    const publicRecipe = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: t.id, visibility: 'public' })
    const privateRecipe = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: t.id, visibility: 'private' })
    const catalog = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const reviewId = await seedReview({ userId: t.id, recipeId: catalog, rating: 5 })

    const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: ' @Violou ' }, headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ ok: true, removedPublicContent: false, notifiedByEmail: true, emailSent: true })

    // Anonimizada e bloqueada; o privado saiu, o público ficou com o autor anonimizado.
    const u = await readUser(t.id)
    expect(u).toMatchObject({ ...erasedIdentity(t.id) })
    expect(u.deletedAt).not.toBeNull()
    expect(u.anonymizedAt).not.toBeNull()
    expect(await recipeExists(privateRecipe)).toBe(false)
    expect(await recipeExists(publicRecipe)).toBe(true)
    expect(await reviewExists(reviewId)).toBe(true)

    // O registro: só o fato. Nenhuma coluna com e-mail, nome ou @.
    const rows = await closures()
    expect(rows).toHaveLength(1)
    const { id, createdAt, ...fact } = rows[0]
    expect(id).toBeTruthy()
    expect(createdAt).toBeInstanceOf(Date)
    expect(fact).toEqual({
      userId: t.id,
      reason: 'violacao_grave',
      removedPublicContent: false,
      notifiedByEmail: true,
      decidedBy: adminId,
    })
    expect(JSON.stringify(rows[0])).not.toMatch(/violou|Pessoa Alvo/)
    // Decisão do controlador, não pedido do titular: nenhum evento DSAR.
    expect(await getDb().select().from(dsarAuditEvent)).toEqual([])

    // O e-mail foi para o endereço REAL (lido antes da eliminação), em en-US, com o link dos Termos em en-US.
    expect(mailer.accountSent).toHaveLength(1)
    const mail = mailer.accountSent[0]
    expect(mail.to).toBe('violou@closure.test')
    expect(mail.subject).toBe(enUS.auth.emailEncerradaAssunto)
    expect(mail.text).toContain('/en-US/termos')
    expect(mail.text).toContain('privacidade@refogando.com')

    // Uma linha de log, sem id, e-mail nem nome.
    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[admin-erasure]'))
    expect(lines).toEqual(['[admin-erasure] concluída: motivo=violacao_grave conteudoPublicoRemovido=false avisoPorEmail=true'])
  })

  it('notify=false → sem e-mail, registro com notifiedByEmail=false; conta sem idioma recebe em pt-BR', async () => {
    const { headers } = await admin()
    const quiet = await target({ email: 'quieto@closure.test', handle: 'quieto' })
    const res = await post(quiet.id, { reason: 'violacao_grave', notify: false, confirmHandle: 'quieto' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ notifiedByEmail: false, emailSent: false })
    expect(mailer.accountSent).toEqual([])
    expect((await closures())[0].notifiedByEmail).toBe(false)

    const loud = await target({ email: 'semidioma@closure.test', handle: 'semidioma' })
    expect((await post(loud.id, { reason: 'violacao_grave', confirmHandle: 'semidioma' }, headers)).status).toBe(200)
    expect(mailer.accountSent).toHaveLength(1)
    expect(mailer.accountSent[0].subject).toBe(ptBR.auth.emailEncerradaAssunto)
    expect(mailer.accountSent[0].text).toContain('/pt-BR/termos')
  })

  it('e-mail não confirmado → não manda (o endereço pode não ser da pessoa)', async () => {
    const { headers } = await admin()
    const t = await target({ email: 'naoconfirmado@closure.test', handle: 'naoconfirmado', emailVerified: false })
    const res = await post(t.id, { reason: 'violacao_grave', confirmHandle: t.handle }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ notifiedByEmail: false, emailSent: false })
    expect(mailer.accountSent).toEqual([])
  })
})

describe('menor de 16', () => {
  it('com removePublicContent: as receitas públicas e TODAS as avaliações saem, com os blobs; a derivada de terceiro fica', async () => {
    const { userId: adminId, headers } = await admin()
    const t = await target({ handle: 'menor-conta' })
    const other = await seedUser({ email: 'terceiro@closure.test' })

    // Receita pública dela, com imagem e com uma avaliação de terceiro com foto.
    const pub = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: t.id, visibility: 'public' })
    const imageUrl = await blob('recipes')
    await seedRecipeImage({ recipeId: pub, blobUrl: imageUrl, createdBy: t.id })
    const thirdPartyReview = await reviewWithPhoto(other, pub)
    // Derivada de terceiro, a partir da receita pública dela.
    const derived = await seedRecipe({ origin: 'user_edited', originalLocale: 'pt-BR', ownerId: other, parentRecipeId: pub, lineageKind: 'edited' })
    // Avaliações dela: uma comum com foto e uma moderada (o `applyReview` pularia).
    const catalog = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const catalog2 = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const ownReview = await reviewWithPhoto(t.id, catalog)
    const moderated = await seedReview({ userId: t.id, recipeId: catalog2, rating: 1, moderated: { curatorId: adminId } })
    const otherReviewOnCatalog = await seedReview({ userId: other, recipeId: catalog, rating: 3 })

    const res = await post(t.id, { reason: 'menor_16', removePublicContent: true, notify: true, confirmHandle: 'menor-conta' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, removedPublicContent: true, notifiedByEmail: false, emailSent: false })

    expect(await recipeExists(pub)).toBe(false)
    expect(await reviewExists(thirdPartyReview.id)).toBe(false)
    expect(await reviewExists(ownReview.id)).toBe(false)
    expect(await reviewExists(moderated)).toBe(false)
    expect(await reviewExists(otherReviewOnCatalog)).toBe(true)
    expect(store.blobs.has(imageUrl)).toBe(false)
    expect(store.blobs.has(thirdPartyReview.url)).toBe(false)
    expect(store.blobs.has(ownReview.url)).toBe(false)

    expect(await recipeExists(derived)).toBe(true)
    const [d] = await getDb().select({ parent: recipe.parentRecipeId }).from(recipe).where(eq(recipe.id, derived))
    expect(d.parent).toBeNull()

    expect((await readUser(t.id)).anonymizedAt).not.toBeNull()
    const [row] = await closures()
    expect(row).toMatchObject({ userId: t.id, reason: 'menor_16', removedPublicContent: true, notifiedByEmail: false, decidedBy: adminId })
    // Sem e-mail de encerramento no menor de 16 (o aviso foi o e-mail de antes, P1).
    expect(mailer.accountSent).toEqual([])
  })

  it('sem removePublicContent: o público fica anonimizado, como em toda eliminação', async () => {
    const { headers } = await admin()
    const t = await target({ handle: 'menor-fica' })
    const pub = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: t.id, visibility: 'public' })
    const catalog = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
    const review = await seedReview({ userId: t.id, recipeId: catalog, rating: 4 })

    const res = await post(t.id, { reason: 'menor_16', confirmHandle: 'menor-fica' }, headers)
    expect(res.status).toBe(200)
    expect(await recipeExists(pub)).toBe(true)
    expect(await reviewExists(review)).toBe(true)
    expect((await closures())[0].removedPublicContent).toBe(false)
  })
})

describe('self-service intacto', () => {
  it('eraseOwnAccount segue gravando um DSAR_RECEIVED self_service e nenhum registro de encerramento', async () => {
    const t = await target()
    expect((await eraseOwnAccount(getDb(), { userId: t.id })).kind).toBe('erased')
    const events = await getDb()
      .select({ eventType: dsarAuditEvent.eventType, channel: dsarAuditEvent.channel, requestType: dsarAuditEvent.requestType, actorId: dsarAuditEvent.actorId })
      .from(dsarAuditEvent)
    expect(events).toEqual([{ eventType: 'DSAR_RECEIVED', channel: 'self_service', requestType: 'account_erasure', actorId: t.id }])
    expect(await closures()).toEqual([])
  })

  it('o registro barra apagar a linha users (RESTRICT) e o CHECK barra conteúdo público fora do menor de 16', async () => {
    const t = await target()
    await getDb().insert(accountClosure).values({ userId: t.id, reason: 'violacao_grave', notifiedByEmail: false })
    await expect(getDb().delete(users).where(eq(users.id, t.id))).rejects.toThrow()
    await expect(
      getDb().insert(accountClosure).values({ userId: t.id, reason: 'violacao_grave', removedPublicContent: true, notifiedByEmail: false }),
    ).rejects.toThrow()
    const [{ n }] = await getDb().select({ n: sql<number>`count(*)::int` }).from(accountClosure)
    expect(n).toBe(1)
  })
})
