import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/me/export/route'
import { getDb } from '@/server/deps'
import { eq } from 'drizzle-orm'
import {
  account,
  creationSession,
  extractionEvent,
  generation,
  mealPlanEntry,
  mealPlanSuggestionEvent,
  notification,
  pantryItem,
  recipe,
  session,
  shoppingList,
  shoppingListItem,
  userFollow,
  users,
} from '@/db/schema'
import { PROMPT_VERSION, promptStampFor } from '@/domain/briefing'
import { SCHEMA_VERSION_RECEITA } from '@/domain/recipe'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedRecipeIngredient,
  seedSave,
  seedCollection,
  seedCollectionItem,
  seedReport,
  seedReview,
  seedFeijoadaCatalog,
  seedRecipeImage,
} from '../helpers/recipes'

/**
 * Export self-service dos dados da conta (#401, GAP-6; LGPD Art. 18, II e V). Contrato de
 * `GET /api/me/export`: dump portável (JSON) SÓ do próprio titular, SEM PII de terceiros.
 *
 * Inegociáveis testados: só-titular (401 sem sessão / conta desativada); NUNCA e-mail de
 * terceiros (a lista de seguidores é só CONTAGEM; a de seguindo traz só HANDLE público; as
 * notificações não trazem a identidade do ator); só o conteúdo do PRÓPRIO titular (receita de
 * outro dono NÃO aparece).
 *
 * #595 completou o export: imagens do titular, acessos (sem o token da sessão), logins (sem senha nem
 * tokens), plano e sanções da conta, moderação do conteúdo dele (sem o id do Curador), denúncias que ELE
 * fez (nunca as de terceiros sobre ele), registros de uso da Extração e da Sugestão de cardápio, e
 * tokens/custo das gerações (o `promptStamp` sem texto de admin). A resposta sai em streaming, só para a
 * mesma origem ou o endereço digitado, e o `Content-Disposition` leva a data do `exportedAt` no nome.
 */

function get(headers?: Headers, site?: string): Promise<Response> {
  const h = new Headers(headers)
  if (site !== undefined) h.set('sec-fetch-site', site)
  return GET(new Request('http://localhost/api/me/export', { headers: h }))
}

describe('/api/me/export — acesso + portabilidade do titular (#401)', () => {
  it('sem sessão (Visitante) → 401 nao_autenticado', async () => {
    const res = await get()
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('conta soft-deletada (deletedAt != null) → 401 conta_desativada', async () => {
    const { headers } = await seedSessionHeaders({
      email: 'apagado@me-export.test',
      deletedAt: new Date(),
    })
    const res = await get(headers)
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'conta_desativada' })
  })

  it('dump portável: perfil + conteúdo do próprio titular, com headers de download', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'titular@me-export.test' })

    // Receita PRÓPRIA (owner_id = titular) com tradução + ingrediente.
    const ownRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
    })
    await seedTranslation({
      recipeId: ownRecipe,
      locale: 'pt-BR',
      titulo: 'Meu Bolo Secreto',
      provenance: 'escrita_por_pessoa',
      descricao: 'Descrição do meu bolo.',
      passos: ['Bater', 'Assar'],
    })
    await seedRecipeIngredient({ recipeId: ownRecipe, ordem: 0, rawText: '2 ovos' })

    // Catálogo salvo + numa coleção + avaliado pelo titular.
    const { recipeId: feijoada } = await seedFeijoadaCatalog()
    await seedSave({ userId, recipeId: feijoada })
    const col = await seedCollection({ userId, name: 'Favoritas' })
    await seedCollectionItem({ collectionId: col, recipeId: feijoada })
    await seedReview({ userId, recipeId: feijoada, rating: 5, comment: 'Excelente!' })

    // Lista de compras com um item (ADR-0032) + uma Refeição planejada (ADR-0035).
    const [list] = await getDb()
      .insert(shoppingList)
      .values({ userId, name: 'Feira de sábado' })
      .returning({ id: shoppingList.id })
    await getDb().insert(shoppingListItem).values({
      listId: list.id,
      nome: 'Feijão preto',
      matchKey: 'n:feijao preto',
      quantidade: '500',
      unidade: 'g',
      sourceRecipeId: feijoada,
    })
    await getDb()
      .insert(mealPlanEntry)
      .values({ userId, day: '2026-09-29', slot: 'almoco', recipeId: feijoada, porcoes: 4 })
    await getDb().insert(mealPlanEntry).values({ userId, day: '2026-09-30', slot: 'jantar', note: 'Jantar fora' })
    await getDb().insert(pantryItem).values({ userId, nome: 'Ovo caipira', matchKey: 'ovo caipira' })
    await getDb().update(users).set({ pantryBasics: ['sal', 'alho'] }).where(eq(users.id, userId))

    const res = await get(headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('cache-control')).toBe('no-store')

    const dump = (await res.json()) as {
      format: string
      account: { id: string; email: string; handle: string }
      recipes: Array<{ id: string; translations: Array<{ titulo: string }>; ingredients: unknown[] }>
      savedRecipes: Array<{ recipeId: string }>
      collections: Array<{ name: string; recipeIds: string[] }>
      reviews: Array<{ recipeId: string; rating: number; comment: string | null }>
      shoppingLists: Array<{
        name: string
        items: Array<{ nome: string; quantidade: string | null; unidade: string | null; sourceRecipeId: string | null }>
      }>
      mealPlan: Array<{ day: string; slot: string; recipeId: string | null; note: string | null; porcoes: number | null }>
      pantry: Array<{ nome: string }>
      pantryBasics: string[] | null
    }

    expect(dump.format).toBe('refogando-account-export/v1')
    expect(dump.account.id).toBe(userId)
    expect(dump.account.email).toBe('titular@me-export.test')

    // Receita própria com filhos.
    const exported = dump.recipes.find((r) => r.id === ownRecipe)
    expect(exported).toBeDefined()
    expect(exported!.translations[0]?.titulo).toBe('Meu Bolo Secreto')
    expect(exported!.ingredients).toHaveLength(1)

    // Save + coleção + avaliação.
    expect(dump.savedRecipes.map((s) => s.recipeId)).toContain(feijoada)
    expect(dump.collections.find((c) => c.name === 'Favoritas')?.recipeIds).toEqual([feijoada])
    expect(dump.reviews.find((r) => r.recipeId === feijoada)).toMatchObject({
      rating: 5,
      comment: 'Excelente!',
    })

    // Lista de compras + itens e o plano de refeições do titular.
    expect(dump.shoppingLists).toHaveLength(1)
    expect(dump.shoppingLists[0]).toMatchObject({
      name: 'Feira de sábado',
      items: [{ nome: 'Feijão preto', quantidade: '500.000', unidade: 'g', sourceRecipeId: feijoada }],
    })
    expect(dump.mealPlan).toEqual([
      expect.objectContaining({ day: '2026-09-29', slot: 'almoco', recipeId: feijoada, note: null, porcoes: 4 }),
      // Anotação livre (ADR-0037): texto do próprio titular, entra no export.
      expect.objectContaining({ day: '2026-09-30', slot: 'jantar', recipeId: null, note: 'Jantar fora', porcoes: null }),
    ])
    // Despensa (ADR-0038): os nomes que o titular digitou.
    expect(dump.pantry).toEqual([expect.objectContaining({ nome: 'Ovo caipira' })])
    // E os básicos que ele escolheu (ADR-0042).
    expect(dump.pantryBasics).toEqual(['sal', 'alho'])
  })

  it('NÃO vaza PII de terceiros: seguindo traz só handle, seguidores só contagem, sem e-mail de outros', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'a@me-export.test' })
    const other = await seedUser({ email: 'terceiro@sigiloso.test', handle: 'terceiro-pub' })

    // Titular segue `other`; `other` segue o titular (aresta de terceiro).
    await getDb().insert(userFollow).values({ followerId: userId, followeeId: other })
    await getDb().insert(userFollow).values({ followerId: other, followeeId: userId })
    // Notificação para o titular com o TERCEIRO como ator.
    await getDb()
      .insert(notification)
      .values({ recipientId: userId, type: 'new_follower', actorId: other })

    const res = await get(headers)
    expect(res.status).toBe(200)
    const raw = await res.text()

    // O e-mail do TERCEIRO NUNCA pode aparecer no dump.
    expect(raw).not.toContain('terceiro@sigiloso.test')

    const dump = JSON.parse(raw) as {
      social: { followingCount: number; followersCount: number; following: Array<{ handle: string }> }
      notifications: Array<{ type: string; actorId?: unknown; actorHandle?: unknown }>
    }
    // Seguindo: só o handle PÚBLICO do terceiro (permitido); contagens corretas.
    expect(dump.social.following).toEqual([{ handle: 'terceiro-pub', since: expect.anything() }])
    expect(dump.social.followingCount).toBe(1)
    expect(dump.social.followersCount).toBe(1)

    // Notificações do titular: tipo/timestamps, SEM identidade do ator (nem id, nem handle).
    const notif = dump.notifications.find((n) => n.type === 'new_follower')
    expect(notif).toBeDefined()
    expect(notif).not.toHaveProperty('actorId')
    expect(notif).not.toHaveProperty('actorHandle')
  })

  it('só o conteúdo do PRÓPRIO titular: receita de outro dono NÃO aparece (sem IDOR)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'dono-a@me-export.test' })
    const other = await seedUser({ email: 'dono-b@me-export.test', handle: 'dono-b' })
    const foreignRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: other,
      visibility: 'public',
    })
    const mineRecipe = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: userId,
      visibility: 'private',
    })

    const res = await get(headers)
    const dump = (await res.json()) as { recipes: Array<{ id: string }> }
    const ids = dump.recipes.map((r) => r.id)
    expect(ids).toContain(mineRecipe)
    expect(ids).not.toContain(foreignRecipe)
  })

  it('#595: imagens, acessos, logins, sanções, moderação, denúncias feitas, registros de uso e custo das gerações — sem credencial nem terceiros', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'completo@me-export.test' })
    const other = await seedUser({ email: 'outro@me-export.test', handle: 'outro-export' })
    const curator = await seedUser({ email: 'curador@me-export.test', handle: 'curador-export' })
    const db = getDb()

    // Imagens: uma gerada pelo titular na receita dele (moderada); a de um terceiro na receita do TERCEIRO
    // (o seed reaponta a capa da receita-alvo, então cada uma fica na sua).
    const ownRecipe = await seedRecipe({ origin: 'ai_structured', originalLocale: 'pt-BR', ownerId: userId })
    const foreign = await seedRecipe({
      origin: 'ai_structured',
      originalLocale: 'pt-BR',
      ownerId: other,
      visibility: 'public',
    })
    const ownImage = await seedRecipeImage({
      recipeId: ownRecipe,
      provenance: 'ai_generated',
      blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/minha.png',
      createdBy: userId,
      moderated: { curatorId: curator, reason: 'Imagem fora do tema' },
    })
    const foreignImage = await seedRecipeImage({
      recipeId: foreign,
      blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/de-terceiro.webp',
      createdBy: other,
    })

    // Moderação do conteúdo do titular: a receita saiu do pool; a avaliação dele foi moderada.
    await db
      .update(recipe)
      .set({ moderationRemovedAt: new Date(), moderatedBy: curator, moderationReason: 'Receita fora das regras' })
      .where(eq(recipe.id, ownRecipe))
    await seedReview({
      userId,
      recipeId: foreign,
      rating: 1,
      comment: 'Não gostei',
      moderated: { curatorId: curator, reason: 'Avaliação ofensiva' },
    })

    // Sanções sobre a conta (depois do login: o Better Auth só barra banido ao CRIAR a sessão).
    const banExpires = new Date('2027-01-01T00:00:00Z')
    await db
      .update(users)
      .set({
        banned: true,
        banReason: 'Spam repetido',
        banExpires,
        imageGenBlockedAt: new Date(),
        imageGenBlockedBy: curator,
        imageGenBlockedReason: 'Abuso na geração de imagem',
      })
      .where(eq(users.id, userId))

    // Logins: senha (hash) e Google (tokens). Nada disso pode sair, só provedor, conta, escopo e datas.
    await db.insert(account).values({
      userId,
      accountId: userId,
      providerId: 'credential',
      password: 'HASH-DA-SENHA-SIGILOSO',
    })
    await db.insert(account).values({
      userId,
      accountId: 'google-sub-123',
      providerId: 'google',
      accessToken: 'ACCESS-TOKEN-SIGILOSO',
      refreshToken: 'REFRESH-TOKEN-SIGILOSO',
      idToken: 'ID-TOKEN-SIGILOSO',
      accessTokenExpiresAt: new Date('2026-12-01T00:00:00Z'),
      refreshTokenExpiresAt: new Date('2027-06-01T00:00:00Z'),
      scope: 'openid email profile',
    })

    // Acesso: IP e navegador na sessão de login do titular; o token NUNCA pode sair.
    await db
      .update(session)
      .set({ ipAddress: '203.0.113.7', userAgent: 'E2E-UA' })
      .where(eq(session.userId, userId))
    const [loginRow] = await db
      .select({
        token: session.token,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        expiresAt: session.expiresAt,
      })
      .from(session)
      .where(eq(session.userId, userId))

    // Denúncias: a que o titular fez entra; a de um terceiro sobre a receita do titular, não.
    await seedReport({ reporterId: userId, recipeId: foreign, reason: 'Spam' })
    await seedReport({ reporterId: other, recipeId: ownRecipe, reason: 'Denúncia de terceiro' })

    // Registros de uso: duas extrações e uma sugestão de cardápio.
    await db.insert(extractionEvent).values([{ userId }, { userId }])
    await db.insert(mealPlanSuggestionEvent).values({
      userId,
      model: 'claude-sonnet-5-5',
      inputTokens: 1200,
      outputTokens: 300,
      costUsd: '0.012345',
    })

    // Uma geração de texto com tokens, custo e carimbo do prompt — com texto de admin e de Curador nos eixos.
    const [cs] = await db
      .insert(creationSession)
      .values({ userId, mode: 'free_text', freeText: 'um bolo de cenoura' })
      .returning({ id: creationSession.id })
    await db.insert(generation).values({
      creationSessionId: cs.id,
      recipeId: ownRecipe,
      outcome: 'success',
      model: 'claude-opus-5-5',
      schemaVersion: SCHEMA_VERSION_RECEITA,
      inputTokens: 900,
      outputTokens: 1500,
      costUsd: '0.050000',
      promptStamp: promptStampFor({
        nivelChef: 'iniciante',
        vozCozinha: { nome: 'baiana', notaCurada: 'NOTA-CURADA-DO-CURADOR' },
        variacaoDivergente: { poloA: 'leve', poloB: 'indulgente', instrucao: 'INSTRUCAO-DO-ADMIN' },
      }),
    })

    const res = await get(headers)
    expect(res.status).toBe(200)
    const raw = await res.text()

    // Credenciais, ids de Curador, texto de admin e conteúdo de terceiros nunca aparecem no texto do dump.
    for (const secret of [
      loginRow.token,
      'HASH-DA-SENHA-SIGILOSO',
      'ACCESS-TOKEN-SIGILOSO',
      'REFRESH-TOKEN-SIGILOSO',
      'ID-TOKEN-SIGILOSO',
      curator,
      'NOTA-CURADA-DO-CURADOR',
      'INSTRUCAO-DO-ADMIN',
      'Denúncia de terceiro',
      'de-terceiro.webp',
    ]) {
      expect(raw).not.toContain(secret)
    }
    expect(raw).not.toMatch(/accessTokenExpiresAt|refreshTokenExpiresAt|"password"|"idToken"/)

    const dump = JSON.parse(raw) as {
      account: Record<string, unknown>
      recipes: Array<{ id: string; imageId: string | null } & Record<string, unknown>>
      recipeImages: Array<Record<string, unknown>>
      reviews: Array<Record<string, unknown>>
      loginSessions: Array<Record<string, unknown>>
      logins: Array<Record<string, unknown>>
      reports: Array<Record<string, unknown>>
      extractionEvents: Array<{ createdAt: string }>
      mealPlanSuggestionEvents: Array<Record<string, unknown>>
      creationSessions: Array<{ generations: Array<Record<string, unknown>> }>
    }

    // Plano e sanções na conta, sem quem bloqueou.
    expect(dump.account).toMatchObject({
      plan: 'free',
      banned: true,
      banReason: 'Spam repetido',
      banExpires: banExpires.toISOString(),
      imageGenBlockedAt: expect.any(String),
      imageGenBlockedReason: 'Abuso na geração de imagem',
    })
    expect(dump.account).not.toHaveProperty('imageGenBlockedBy')

    // Imagens: só a do titular, com proveniência, URLs e a moderação; a capa da receita dele aponta para ela.
    expect(dump.recipeImages).toEqual([
      {
        id: ownImage,
        provenance: 'ai_generated',
        sourceImageId: null,
        blobUrl: 'https://abc.public.blob.vercel-storage.com/recipes/minha.png',
        detailUrl: null,
        thumbUrl: null,
        moderatedAt: expect.any(String),
        moderatedReason: 'Imagem fora do tema',
        createdAt: expect.any(String),
      },
    ])
    expect(dump.recipeImages.map((i) => i.id)).not.toContain(foreignImage)
    const own = dump.recipes.find((r) => r.id === ownRecipe)
    expect(own?.imageId).toBe(ownImage)

    // Moderação da receita e da avaliação do titular, sem o `moderatedBy`.
    expect(own).toMatchObject({ moderationRemovedAt: expect.any(String), moderationReason: 'Receita fora das regras' })
    expect(own).not.toHaveProperty('moderatedBy')
    expect(dump.reviews).toEqual([
      expect.objectContaining({
        recipeId: foreign,
        comment: 'Não gostei',
        moderatedAt: expect.any(String),
        moderatedReason: 'Avaliação ofensiva',
      }),
    ])
    expect(dump.reviews[0]).not.toHaveProperty('moderatedBy')

    // Acessos: ip, navegador e as três datas; sem `token` nem `id`.
    expect(dump.loginSessions).toHaveLength(1)
    expect(dump.loginSessions[0]).toEqual({
      createdAt: loginRow.createdAt.toISOString(),
      updatedAt: loginRow.updatedAt.toISOString(),
      expiresAt: loginRow.expiresAt.toISOString(),
      ipAddress: '203.0.113.7',
      userAgent: 'E2E-UA',
    })
    expect(dump.loginSessions[0]).not.toHaveProperty('token')
    expect(dump.loginSessions[0]).not.toHaveProperty('id')

    // Logins: só provedor, conta no provedor, escopo e datas (objeto exato: nenhuma chave a mais).
    expect(dump.logins).toHaveLength(2)
    expect(dump.logins).toEqual(
      expect.arrayContaining([
        { provider: 'credential', accountId: userId, scope: null, createdAt: expect.any(String), updatedAt: expect.any(String) },
        {
          provider: 'google',
          accountId: 'google-sub-123',
          scope: 'openid email profile',
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        },
      ]),
    )

    // Denúncias: só a que o titular fez, sem o Curador que resolveria.
    expect(dump.reports).toEqual([
      {
        recipeId: foreign,
        reviewId: null,
        reason: 'Spam',
        status: 'pending',
        createdAt: expect.any(String),
        resolvedAt: null,
      },
    ])
    expect(dump.reports[0]).not.toHaveProperty('resolvedBy')

    // Registros de uso.
    expect(dump.extractionEvents).toHaveLength(2)
    expect(dump.extractionEvents[0]).toEqual({ createdAt: expect.any(String) })
    expect(dump.mealPlanSuggestionEvents).toEqual([
      {
        model: 'claude-sonnet-5-5',
        inputTokens: 1200,
        outputTokens: 300,
        costUsd: '0.012345',
        createdAt: expect.any(String),
      },
    ])

    // Geração: tokens, custo e o carimbo do prompt só com versão e rótulos dos eixos.
    expect(dump.creationSessions).toHaveLength(1)
    expect(dump.creationSessions[0].generations).toEqual([
      expect.objectContaining({
        recipeId: ownRecipe,
        outcome: 'success',
        model: 'claude-opus-5-5',
        inputTokens: 900,
        outputTokens: 1500,
        costUsd: '0.050000',
        promptStamp: {
          version: PROMPT_VERSION,
          axes: {
            nivelChef: 'iniciante',
            vozCozinha: { nome: 'baiana' },
            variacaoDivergente: { poloA: 'leve', poloB: 'indulgente' },
          },
        },
        variantLabel: null,
        variantChosen: null,
      }),
    ])
  })

  it('#595: Sec-Fetch-Site de outro site → 403 antes da sessão; a interface (same-origin) e o endereço digitado (none) baixam', async () => {
    const { headers } = await seedSessionHeaders({ email: 'origem@me-export.test' })
    for (const site of ['cross-site', 'same-site']) {
      const res = await get(headers, site)
      expect(res.status).toBe(403)
      expect(res.headers.get('cache-control')).toBe('no-store')
      await expect(res.json()).resolves.toEqual({ error: 'origem_nao_permitida' })
    }
    // Sem sessão e de outro site: o 403 vem antes (não vira oráculo de "logado ou não").
    expect((await get(undefined, 'cross-site')).status).toBe(403)

    for (const site of ['same-origin', 'none']) {
      const res = await get(headers, site)
      expect(res.status).toBe(200)
      await expect(res.json()).resolves.toMatchObject({ format: 'refogando-account-export/v1' })
    }
  })

  it('#595: conta grande sai em streaming, seção por seção, acima dos 4,5 MB e com JSON válido', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'grande@me-export.test' })
    const db = getDb()
    const [list] = await db
      .insert(shoppingList)
      .values({ userId, name: 'Lista enorme' })
      .returning({ id: shoppingList.id })
    const ITEMS = 24_000
    const BATCH = 8_000
    for (let start = 0; start < ITEMS; start += BATCH) {
      await db.insert(shoppingListItem).values(
        Array.from({ length: BATCH }, (_, k) => ({
          listId: list.id,
          nome: `Item ${start + k} da feira grande`,
          matchKey: `n:item ${start + k}`,
          quantidade: '1',
          unidade: 'unidade' as const,
        })),
      )
    }

    const res = await get(headers, 'same-origin')
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let raw = ''
    let chunks = 0
    let bytes = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks += 1
      bytes += value.byteLength
      raw += decoder.decode(value, { stream: true })
    }
    raw += decoder.decode()

    // Um pedaço por seção de topo (bem mais de um), e o total passa do teto de uma resposta não transmitida.
    expect(chunks).toBeGreaterThan(10)
    expect(bytes).toBeGreaterThan(4.5 * 1024 * 1024)
    const dump = JSON.parse(raw) as { shoppingLists: Array<{ items: unknown[] }> }
    expect(dump.shoppingLists).toHaveLength(1)
    expect(dump.shoppingLists[0].items).toHaveLength(ITEMS)
    // O mesmo texto de um `JSON.stringify(dump, null, 2)`.
    expect(raw).toBe(JSON.stringify(dump, null, 2))
  })

  it('#595: o Content-Disposition leva a data do exportedAt no nome', async () => {
    const { headers } = await seedSessionHeaders({ email: 'nome-arquivo@me-export.test' })
    const res = await get(headers)
    expect(res.status).toBe(200)
    const dump = (await res.json()) as { exportedAt: string }
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="refogando-meus-dados-${dump.exportedAt.slice(0, 10)}.json"`,
    )
  })

  it('#595: conta sem nada disso → seções novas vazias (nunca ausentes)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'vazio@me-export.test' })
    const dump = (await (await get(headers)).json()) as Record<string, unknown>
    expect(dump.recipeImages).toEqual([])
    expect(dump.reports).toEqual([])
    expect(dump.extractionEvents).toEqual([])
    expect(dump.mealPlanSuggestionEvents).toEqual([])
    // A própria sessão do pedido conta como um acesso.
    expect(dump.loginSessions).toHaveLength(1)
  })
})
