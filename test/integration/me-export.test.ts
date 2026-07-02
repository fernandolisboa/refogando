import { describe, expect, it } from 'vitest'
import { GET } from '@/app/api/me/export/route'
import { getDb } from '@/server/deps'
import { notification, userFollow } from '@/db/schema'
import { seedSessionHeaders, seedUser } from '../helpers/users'
import {
  seedRecipe,
  seedTranslation,
  seedRecipeIngredient,
  seedSave,
  seedCollection,
  seedCollectionItem,
  seedReview,
  seedFeijoadaCatalog,
} from '../helpers/recipes'

/**
 * Export self-service dos dados da conta (#401, GAP-6; LGPD Art. 18 II/V). Contrato de
 * `GET /api/me/export`: dump portável (JSON) SÓ do próprio titular, SEM PII de terceiros.
 *
 * Inegociáveis testados: só-titular (401 sem sessão / conta desativada); NUNCA e-mail de
 * terceiros (a lista de seguidores é só CONTAGEM; a de seguindo traz só HANDLE público; as
 * notificações não trazem a identidade do ator); só o conteúdo do PRÓPRIO titular (receita de
 * outro dono NÃO aparece).
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/me/export', { headers }))
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
})
