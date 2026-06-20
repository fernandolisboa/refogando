import { afterAll, beforeAll, beforeEach, describe, expect, it, inject } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { getDb, setImageStore, setClaudeClient, setEmbedder } from '@/server/deps'
import { FakeImageStore } from '@/server/images/image-store'
import { FakeClaudeClient } from '@/server/claude/client'
import type { Embedder } from '@/server/embedding/embedder'
import { recipe, recipeImage, creationSession } from '@/db/schema'
import { EMBEDDING_DIMENSIONS } from '@/db/schema'
import { POST as deriveRoute } from '@/app/api/recipes/[id]/derive/route'
import { PATCH as editRoute } from '@/app/api/recipes/[id]/route'
import { POST as regenerateRoute } from '@/app/api/recipes/[id]/regenerate/route'
import { seedRecipe, seedTranslation, seedRecipeIngredient } from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess } from '../helpers/generation'

/**
 * Carry-forward da Imagem da receita ao versionar (#131, ADR-0016): editar/derivar/regenerar herda
 * o `image_id` (mesmo blob, sem arquivo novo) e — quando a mudança é VISUAL (título/ingredientes/
 * cozinha) numa versão COM imagem — a resposta sinaliza `imageReviewSuggested` (a UI sugere revisar
 * a foto). Mudança só cosmética é silenciosa. FakeImageStore/FakeClaude — sem rede.
 */

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

class FakeEmbedder implements Embedder {
  async embed(): Promise<number[]> {
    return new Array(EMBEDDING_DIMENSIONS).fill(0.1)
  }
}

beforeEach(() => {
  setImageStore(new FakeImageStore())
})

const FAKE_BLOB = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'

/** Insere uma recipe_image e aponta recipe.image_id pra ela. Devolve o imageId. */
async function attachImage(recipeId: string): Promise<string> {
  const [img] = await getDb()
    .insert(recipeImage)
    .values({ blobUrl: FAKE_BLOB, provenance: 'user_photo' })
    .returning({ id: recipeImage.id })
  await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, recipeId))
  return img.id
}
async function imageIdOf(recipeId: string): Promise<string | null> {
  const [r] = await getDb().select({ imageId: recipe.imageId }).from(recipe).where(eq(recipe.id, recipeId))
  return r?.imageId ?? null
}

// ── DERIVAR (#17): a derivada herda image_id da base + flag pela mudança visual ─────────
type Edits = {
  titulo: string
  ingredientes?: { rawText: string | null; quantidade: string | null; unidade?: string | null }[]
  restricoes?: string[]
}
function derive(id: string, edits: Edits, headers: Headers): Promise<Response> {
  return deriveRoute(
    new Request(`http://localhost/api/recipes/${id}/derive?locale=pt-BR`, {
      method: 'POST',
      headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
      body: JSON.stringify({ edits }),
    }),
    { params: Promise.resolve({ id }) },
  )
}

/** Base de catálogo (não-própria, derivável) com título + 1 ingrediente. */
async function seedBase(titulo = 'Bolo', ingrediente = 'farinha'): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: ingrediente, quantidade: null })
  return id
}

describe('Carry-forward da Imagem (#131) — DERIVAR', () => {
  it('mudança VISUAL (título) numa base COM imagem ⇒ derivada herda image_id + imageReviewSuggested', async () => {
    const base = await seedBase()
    const baseImageId = await attachImage(base)
    const { headers } = await seedSessionHeaders({ email: 'derive-big@ic.test' })

    const res = await derive(base, { titulo: 'Bolo de chocolate', ingredientes: [{ rawText: 'farinha', quantidade: null }] }, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(true)
    expect(await imageIdOf(body.recipeId)).toBe(baseImageId) // mesmo blob, sem arquivo novo
  })

  it('mudança só COSMÉTICA (restrição) numa base COM imagem ⇒ herda image_id mas silencioso', async () => {
    const base = await seedBase()
    const baseImageId = await attachImage(base)
    const { headers } = await seedSessionHeaders({ email: 'derive-small@ic.test' })

    // título e conjunto de ingredientes IGUAIS à base; só adiciona uma restrição (cosmético).
    const res = await derive(base, { titulo: 'Bolo', ingredientes: [{ rawText: 'farinha', quantidade: null }], restricoes: ['vegano'] }, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(false)
    expect(await imageIdOf(body.recipeId)).toBe(baseImageId)
  })

  it('base SEM imagem ⇒ derivada sem image_id e silenciosa (nada a revisar)', async () => {
    const base = await seedBase()
    const { headers } = await seedSessionHeaders({ email: 'derive-noimg@ic.test' })

    const res = await derive(base, { titulo: 'Bolo totalmente novo' }, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(false)
    expect(await imageIdOf(body.recipeId)).toBeNull()
  })
})

// ── EDITAR in-place (#21): mesma linha mantém image_id; flag pela mudança visual ────────
function edit(id: string, patch: Record<string, unknown>, headers: Headers): Promise<Response> {
  return editRoute(
    new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`, {
      method: 'PATCH',
      headers: { ...Object.fromEntries(headers), 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    { params: Promise.resolve({ id }) },
  )
}
async function seedOwned(ownerId: string, titulo = 'Sopa'): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_chat', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira', porcoes: 4 })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return id
}

describe('Carry-forward da Imagem (#131) — EDITAR in-place', () => {
  it('editar título numa Receita COM imagem ⇒ image_id intacto + imageReviewSuggested', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-big@ic.test' })
    const id = await seedOwned(userId)
    const imageId = await attachImage(id)

    const res = await edit(id, { titulo: 'Sopa nova' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: true })
    expect(await imageIdOf(id)).toBe(imageId) // mesma linha, mesmo image_id
  })

  it('editar só porções numa Receita COM imagem ⇒ image_id intacto, silencioso', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-small@ic.test' })
    const id = await seedOwned(userId)
    const imageId = await attachImage(id)

    const res = await edit(id, { porcoes: 8 }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: false })
    expect(await imageIdOf(id)).toBe(imageId)
  })

  it('editar título SEM imagem ⇒ silencioso (nada a revisar)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-noimg@ic.test' })
    const id = await seedOwned(userId)

    const res = await edit(id, { titulo: 'Outra' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: false })
  })

  it('editar cozinha numa Receita COM imagem ⇒ imageReviewSuggested (cozinha é visual)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-cozinha@ic.test' })
    const id = await seedOwned(userId) // cozinha 'brasileira'
    await attachImage(id)

    const res = await edit(id, { cozinha: 'italiana' }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: true })
  })

  it('editar o CONJUNTO de ingredientes (in-place) numa Receita COM imagem ⇒ imageReviewSuggested', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-ing@ic.test' })
    const id = await seedOwned(userId)
    await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'arroz', quantidade: null })
    await attachImage(id)

    const res = await edit(id, { ingredientes: [{ rawText: 'feijão', quantidade: null }] }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: true })
  })

  it('editar SÓ a quantidade (mesmo conjunto) numa Receita COM imagem ⇒ silencioso', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'edit-qty@ic.test' })
    const id = await seedOwned(userId)
    await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: 0, rawText: 'arroz', quantidade: null })
    await attachImage(id)

    // Mesmo rótulo 'arroz', só muda a quantidade ⇒ conjunto inalterado ⇒ não é visual.
    const res = await edit(id, { ingredientes: [{ rawText: 'arroz', quantidade: '2.000' }] }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toMatchObject({ imageReviewSuggested: false })
  })
})

// ── REGENERAR (#20): nova versão herda image_id da predecessora + flag pela comparação ──
function regenerate(id: string, headers: Headers): Promise<Response> {
  return regenerateRoute(new Request(`http://localhost/api/recipes/${id}/regenerate`, { method: 'POST', headers }), {
    params: Promise.resolve({ id }),
  })
}
/** Receita ai_free_text PRÓPRIA com sessão recuperável (fonte free_text). `ingredientes` opcionais
 * (rawText) pra controlar a comparação visual do regenerar. Devolve o recipeId. */
async function seedRegenerable(ownerId: string, titulo: string, ingredientes: string[] = []): Promise<string> {
  const id = await seedRecipe({ origin: 'ai_free_text', originalLocale: 'pt-BR', ownerId, visibility: 'private', cozinha: 'brasileira' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'automatica_nao_revisada' })
  for (let i = 0; i < ingredientes.length; i++) {
    await seedRecipeIngredient({ recipeId: id, ingredientId: null, ordem: i, rawText: ingredientes[i], quantidade: null })
  }
  await getDb()
    .insert(creationSession)
    .values({ userId: ownerId, mode: 'free_text', recipeId: id, freeText: 'um prato qualquer pra quatro' })
  return id
}

describe('Carry-forward da Imagem (#131) — REGENERAR', () => {
  beforeEach(() => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess())) // título 'Arroz de forno'
    setEmbedder(new FakeEmbedder())
  })

  it('predecessora COM imagem ⇒ nova versão herda image_id + imageReviewSuggested (título mudou)', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-big@ic.test' })
    const pred = await seedRegenerable(userId, 'Receita original') // ≠ 'Arroz de forno' (canned)
    const imageId = await attachImage(pred)

    const res = await regenerate(pred, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(true) // título 'Receita original' → 'Arroz de forno'
    expect(await imageIdOf(body.recipeId)).toBe(imageId) // herdou o mesmo blob
  })

  it('predecessora SEM imagem ⇒ nova versão sem image_id e silenciosa', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-noimg@ic.test' })
    const pred = await seedRegenerable(userId, 'Receita original')

    const res = await regenerate(pred, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(false)
    expect(await imageIdOf(body.recipeId)).toBeNull()
  })

  it('predecessora COM imagem mas regeneração IDÊNTICA (título/cozinha/ingredientes) ⇒ herda + silenciosa', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'regen-same@ic.test' })
    // Casa o cannedSuccess() default: título 'Arroz de forno', cozinha 'brasileira', e o MESMO
    // conjunto de rawText dos ingredientes — então a comparação visual não acha mudança.
    const pred = await seedRegenerable(userId, 'Arroz de forno', ['2 xícaras de arroz cozido', 'sal a gosto'])
    const imageId = await attachImage(pred)

    const res = await regenerate(pred, headers)
    expect(res.status).toBe(201)
    const body = (await res.json()) as { recipeId: string; imageReviewSuggested: boolean }
    expect(body.imageReviewSuggested).toBe(false) // nada visual mudou
    expect(await imageIdOf(body.recipeId)).toBe(imageId) // mas herdou o blob (carry-forward)
  })
})
