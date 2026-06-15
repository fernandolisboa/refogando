import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { GET, PUT } from '@/app/api/me/locale/route'
import { getDb } from '@/server/deps'
import { recipe } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedFeijoadaCatalog } from '../helpers/recipes'

/**
 * Round-trip de locale do logado (T10, #4.AC5 == #5.AC4). Prova: Visitante (sem sessão)
 * → 401 em GET e PUT; logado: PUT { locale:'en-US' } → 200 e um GET subsequente relê
 * 'en-US'; PUT com locale não suportado → 400 locale_invalido; persistência "entre
 * visitas" (segundo GET com Request NOVA relê o valor gravado).
 *
 * #4.AC4 (E15): trocar locale NÃO cria/edita Receita. Seedamos >=1 recipe com
 * seedFeijoadaCatalog ANTES do PUT, capturamos a contagem (>0) e asserimos igualdade
 * depois — o handler toca SÓ `users`, nunca `recipe`.
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/me/locale', { headers }))
}
function put(body: unknown, headers?: Headers): Promise<Response> {
  return PUT(
    new Request('http://localhost/api/me/locale', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/** Contagem total de Receitas no banco (provar isolamento de #4.AC4). */
async function countRecipes(): Promise<number> {
  const [row] = await getDb().select({ n: sql<number>`count(*)::int` }).from(recipe)
  return row?.n ?? 0
}

describe('/api/me/locale — round-trip de locale do logado', () => {
  it('sem sessão (Visitante) → 401 em GET e PUT', async () => {
    const getRes = await get()
    expect(getRes.status).toBe(401)
    await expect(getRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })

    const putRes = await put({ locale: 'en-US' })
    expect(putRes.status).toBe(401)
    await expect(putRes.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('logado: PUT { locale:"en-US" } → 200 e um GET subsequente relê "en-US"', async () => {
    const { headers } = await seedSessionHeaders({ email: 'eu@me-locale.test' })

    // GET inicial: locale ainda não definido → null.
    const before = await get(headers)
    expect(before.status).toBe(200)
    await expect(before.json()).resolves.toEqual({ locale: null })

    const putRes = await put({ locale: 'en-US' }, headers)
    expect(putRes.status).toBe(200)
    await expect(putRes.json()).resolves.toEqual({ locale: 'en-US' })

    // Round-trip: nova Request de GET relê o valor persistido.
    const after = await get(headers)
    expect(after.status).toBe(200)
    await expect(after.json()).resolves.toEqual({ locale: 'en-US' })
  })

  it('PUT com locale não suportado → 400 locale_invalido (não grava)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'invalido@me-locale.test' })

    for (const bad of ['fr-FR', 'pt', 'xx', '', 123, undefined]) {
      const res = await put({ locale: bad }, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toMatchObject({ error: 'locale_invalido' })
    }

    // O 400 não deixou nada gravado: GET continua null.
    const after = await get(headers)
    await expect(after.json()).resolves.toEqual({ locale: null })
  })

  it('persiste "entre visitas": segunda Request de GET relê o valor gravado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'visitas@me-locale.test' })

    await put({ locale: 'pt-BR' }, headers)

    // "Visita" 1: nova Request.
    const visit1 = await get(headers)
    await expect(visit1.json()).resolves.toEqual({ locale: 'pt-BR' })

    // "Visita" 2: outra Request independente — mesmo valor persistido.
    const visit2 = await get(headers)
    await expect(visit2.json()).resolves.toEqual({ locale: 'pt-BR' })
  })

  it('#4.AC4 (E15): trocar locale NÃO cria/edita Receita', async () => {
    // Seed >=1 Receita ANTES do PUT, captura a contagem.
    await seedFeijoadaCatalog()
    const recipesBefore = await countRecipes()
    expect(recipesBefore).toBeGreaterThan(0)

    const { headers } = await seedSessionHeaders({ email: 'isolamento@me-locale.test' })

    const putRes = await put({ locale: 'en-US' }, headers)
    expect(putRes.status).toBe(200)

    // O handler toca SÓ `users` — a contagem de Receitas não muda.
    const recipesAfter = await countRecipes()
    expect(recipesAfter).toBe(recipesBefore)
  })
})
