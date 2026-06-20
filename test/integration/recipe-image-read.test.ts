import { afterAll, beforeAll, describe, it, expect, inject } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { GET as feedGET } from '@/app/api/feed/route'
import { GET as searchGET } from '@/app/api/search/route'
import { GET as detailGET } from '@/app/api/recipes/[id]/route'
import { getDb } from '@/server/deps'
import { recipe, recipeImage } from '@/db/schema'
import { seedRecipe, seedTranslation } from '../helpers/recipes'

/**
 * Leitura da Imagem da receita (#130) pela porta MAIS ALTA — `imageUrl` aparece no feed, na busca e
 * no detalhe quando a Receita tem `recipe_image`, e fica AUSENTE ("ausente ≠ vazio") quando não tem.
 * Cobre os JOINs SQL distintos (feed.ts, displayTailSql da busca, loadRecipeRows do detalhe).
 */

type Item = { recipeId: string; displayedTitle: string; imageUrl?: string }

let sql: Sql
beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})
afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

const FAKE_BLOB = 'https://abc.public.blob.vercel-storage.com/recipes/x.webp'

/** Catálogo público + título; opcionalmente com uma recipe_image apontada por image_id. */
async function seedCatalog(titulo: string, withImage: boolean): Promise<string> {
  const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, resultKind: 'success' })
  await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  if (withImage) {
    const [img] = await getDb()
      .insert(recipeImage)
      .values({ blobUrl: FAKE_BLOB, provenance: 'user_photo' })
      .returning({ id: recipeImage.id })
    await getDb().update(recipe).set({ imageId: img.id }).where(eq(recipe.id, id))
  }
  return id
}

describe('Imagem da receita — leitura (#130)', () => {
  it('feed: item COM imagem traz imageUrl; SEM imagem o omite', async () => {
    const comFoto = await seedCatalog('Lasanha com foto', true)
    const semFoto = await seedCatalog('Sopa sem foto', false)

    const res = await feedGET(new Request('http://localhost/api/feed?locale=pt-BR'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { feed: Item[] }
    const com = body.feed.find((i) => i.recipeId === comFoto)
    const sem = body.feed.find((i) => i.recipeId === semFoto)
    expect(com?.imageUrl).toBe(FAKE_BLOB)
    expect(sem).toBeDefined()
    expect(sem!.imageUrl).toBeUndefined()
  })

  it('busca: hit COM imagem traz imageUrl (valida o JOIN do displayTailSql)', async () => {
    const id = await seedCatalog('Risoto fotografado', true)

    const res = await searchGET(new Request('http://localhost/api/search?q=Risoto%20fotografado&locale=pt-BR'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { catalogo: Item[] }
    const hit = body.catalogo.find((i) => i.recipeId === id)
    expect(hit?.imageUrl).toBe(FAKE_BLOB)
  })

  it('detalhe: GET traz view.imageUrl quando há imagem', async () => {
    const id = await seedCatalog('Torta detalhada', true)

    const res = await detailGET(new Request(`http://localhost/api/recipes/${id}?locale=pt-BR`), {
      params: Promise.resolve({ id }),
    })
    expect(res.status).toBe(200)
    const view = (await res.json()) as { imageUrl?: string }
    expect(view.imageUrl).toBe(FAKE_BLOB)
  })
})
