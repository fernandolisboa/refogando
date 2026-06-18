import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/recipes/[id]/route'
import {
  seedFeijoadaCatalog,
  seedRecipe,
  seedRecipeNoRestriction,
  seedRecipeUnorderedIngredients,
  seedTranslation,
} from '../helpers/recipes'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Leitura localizada da Receita pela porta mais alta — o handler GET (issue #3).
 * Cobre AC#1–#5 com renders REAIS de rota em ambos os locales contra o Postgres
 * descartável. `setup.ts` aponta o DI para o banco e trunca antes de cada teste.
 */

function get(id: string, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return GET(new Request(`http://localhost/api/recipes/${id}${qs}`), {
    params: Promise.resolve({ id }),
  })
}

/** GET COM headers de sessão (#59) — exercita a resolução de `viewerId` no ramo público. */
function getAs(id: string, headers: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return GET(new Request(`http://localhost/api/recipes/${id}${qs}`, { headers }), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/recipes/[id] — leitura localizada', () => {
  it('404 quando a receita não existe', async () => {
    const res = await get('00000000-0000-0000-0000-000000000000', 'pt-BR')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('id malformado ⇒ 404 (não 500/vazamento de SQL)', async () => {
    // uuid inválido cairia na coluna uuid e faria o Postgres lançar 22P02 → 500.
    // O guard de formato curto-circuita para o MESMO not_found.
    const res = await get('not-a-uuid', 'pt-BR')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('ingredientes: apenas as chaves do contrato (sem vazar id/recipeId/nota/createdAt)', async () => {
    const { recipeId } = await seedFeijoadaCatalog()

    const res = await get(recipeId, 'pt-BR')
    const view = (await res.json()) as {
      ingredients: Array<Record<string, unknown>>
    }

    expect(view.ingredients.length).toBeGreaterThan(0)
    // Conjunto EXATO de chaves — o leak (esp. `nota`) não pode regredir.
    expect(Object.keys(view.ingredients[0]).sort()).toEqual([
      'ordem',
      'quantidade',
      'rawText',
      'unidade',
    ])
  })

  it('ingredientes voltam ordenados por `ordem` (não por ordem de inserção)', async () => {
    const { recipeId } = await seedRecipeUnorderedIngredients()

    const res = await get(recipeId, 'pt-BR')
    const view = (await res.json()) as { ingredients: Array<{ ordem: number }> }

    const ordens = view.ingredients.map((i) => i.ordem)
    expect(ordens).toEqual([0, 1, 2])
  })

  it('AC#1: nome em en-US = original (tradução); corpo cai para pt-BR quando ausente', async () => {
    const { recipeId, tituloPt, tituloEn, descricaoPt, passosPt } = await seedFeijoadaCatalog()

    const res = await get(recipeId, 'en-US')
    expect(res.status).toBe(200)
    const view = (await res.json()) as {
      name: string
      body: { descricao: string | null; passos: string[] | null }
    }

    // Original primário + tradução confiável e diferente entre parênteses.
    expect(view.name).toBe(`${tituloPt} (${tituloEn})`)
    // descricao/passos ausentes em en-US → fallback para pt-BR (não-vazio).
    expect(view.body.descricao).toBe(descricaoPt)
    expect(view.body.passos).toEqual(passosPt)
  })

  it('AC#2: nome em pt-BR (locale = original) sem parênteses', async () => {
    const { recipeId, tituloPt } = await seedFeijoadaCatalog()

    const res = await get(recipeId, 'pt-BR')
    const view = (await res.json()) as { name: string }

    expect(view.name).toBe(tituloPt)
    expect(view.name).not.toContain('(')
  })

  it('AC#3: restricoes=[] ⇒ chave restricoes AUSENTE; cozinha/categoria/tags PRESENTES', async () => {
    const { recipeId } = await seedRecipeNoRestriction()

    const res = await get(recipeId, 'pt-BR')
    const view = (await res.json()) as {
      facets: { cozinha: string; categoria: string; tags: string[] }
    }

    // A chave restricoes não pode sobreviver à serialização do route (não basta []).
    expect(view.facets).not.toHaveProperty('restricoes')
    expect(view.facets.cozinha).toBe('italiana')
    expect(view.facets.categoria).toBe('sobremesa')
    expect(view.facets.tags).toEqual(['clássico'])
  })

  it('AC#4: selo origin presente e schemaVersion === 1', async () => {
    const { recipeId } = await seedFeijoadaCatalog()

    const res = await get(recipeId, 'pt-BR')
    const view = (await res.json()) as { origin: string; schemaVersion: number }

    expect(view.origin).toBe('catalog')
    expect(view.schemaVersion).toBe(1)
  })

  it('AC#5: invariantes idênticas entre locales; nome/corpo diferem', async () => {
    const { recipeId } = await seedFeijoadaCatalog()

    const ptRes = await get(recipeId, 'pt-BR')
    const enRes = await get(recipeId, 'en-US')
    type View = {
      name: string
      porcoes: number | null
      dificuldade: number | null
      ingredients: Array<{ quantidade: string | null; unidade: string | null }>
    }
    const pt = (await ptRes.json()) as View
    const en = (await enRes.json()) as View

    // Subárvore invariante deve ser deep-equal entre os dois renders.
    const invariant = (v: View) => ({
      porcoes: v.porcoes,
      dificuldade: v.dificuldade,
      ingredients: v.ingredients.map((i) => ({ quantidade: i.quantidade, unidade: i.unidade })),
    })
    expect(invariant(en)).toEqual(invariant(pt))

    // quantidade é a string numérica EXATA em escala-3 (com zeros à direita).
    expect(pt.porcoes).toBe(6)
    expect(pt.dificuldade).toBe(3)
    const qFeijao = pt.ingredients.find((i) => i.unidade === 'kg')
    expect(qFeijao?.quantidade).toBe('2.500')

    // Nome e corpo, por outro lado, DIFEREM entre locales.
    expect(en.name).not.toBe(pt.name)
  })
})

describe('GET /api/recipes/[id] — campos de gestão gateados ao dono (#59)', () => {
  type ManageView = {
    canManage?: boolean
    visibility?: string
    resultKind?: string
  }

  // N1 — não-regressão anônima: leitor anônimo de receita de CATÁLOGO (sem cookie) ⇒ 200 e
  // NENHUM campo de gestão (não-vazamento + prova de que o ramo público não virou 401).
  it('N1: leitor anônimo de catálogo ⇒ 200 e SEM canManage/visibility/resultKind', async () => {
    const { recipeId } = await seedFeijoadaCatalog()

    const res = await get(recipeId, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as ManageView
    expect(view).not.toHaveProperty('canManage')
    expect(view).not.toHaveProperty('visibility')
    expect(view).not.toHaveProperty('resultKind')
  })

  // N2 — dono lê a PRÓPRIA receita PÚBLICA: única porta por onde canManage chega à page de
  // detalhe via GET (não via publish/unpublish). 200 + os três campos de gestão presentes.
  it('N2: dono lê própria receita pública ⇒ canManage=true + visibility + resultKind', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'owner-get-pub@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId: userId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    const res = await getAs(id, headers, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as ManageView
    expect(view.canManage).toBe(true)
    expect(view.visibility).toBe('public')
    expect(view.resultKind).toBe('success')
  })

  // N3 — não-dono AUTENTICADO lê pública alheia: a guarda de cookie dispara getSession, mas
  // viewerId !== ownerId ⇒ 200 e SEM campos de gestão (não vaza "gerida por você" a terceiro).
  it('N3: não-dono autenticado lê pública alheia ⇒ 200 e SEM canManage', async () => {
    const { userId: ownerId } = await seedSessionHeaders({ email: 'owner-get-other@ex.com' })
    const { headers: intruderHeaders } = await seedSessionHeaders({ email: 'intruder-get@ex.com' })
    const id = await seedRecipe({
      origin: 'ai_chat',
      originalLocale: 'pt-BR',
      visibility: 'public',
      resultKind: 'success',
      ownerId,
    })
    await seedTranslation({ recipeId: id, locale: 'pt-BR', titulo: 'Bolo', provenance: 'escrita_por_pessoa' })

    const res = await getAs(id, intruderHeaders, 'pt-BR')
    expect(res.status).toBe(200)
    const view = (await res.json()) as ManageView
    expect(view).not.toHaveProperty('canManage')
    expect(view).not.toHaveProperty('visibility')
    expect(view).not.toHaveProperty('resultKind')
  })
})
