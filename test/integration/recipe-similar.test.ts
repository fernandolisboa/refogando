import { describe, it, expect } from 'vitest'
import { getDb } from '@/server/deps'
import { loadSimilarRecipes, SIMILAR_RECIPES_LIMIT } from '@/server/recipe/similar'
import { seedRecipe, seedTranslation, seedEmbedding, seedRemovedFromPool } from '../helpers/recipes'
import { seedUser } from '../helpers/users'
import type { Origin, Visibility, ResultKind } from '@/domain/recipe'
import type { CurationStatus } from '@/domain/recipe-curation'

/**
 * `loadSimilarRecipes` (#454) — vizinhos por cosseno de `recipe_embedding`, gateados pelos MESMOS 4
 * predicados de `eligibleForPool` (@/domain/recipe-pool). Vetores 1536-dim pinados (eK = base
 * canônica, mesmo padrão de `search-semantica.test.ts`) — cosseno auditável e determinístico.
 *
 * TESTE DE NÃO-VAZAMENTO (INEGOCIÁVEL, memória ADR-0026/#238): receita privada, moderada, de
 * catálogo pendente de curadoria, ou importada da web NUNCA pode aparecer como "semelhante" —
 * mesmo com similaridade de cosseno MUITO forte (0.95+). Cada uma das 4 é semeada com cosseno
 * forte E testada isoladamente, mais um controle NÃO-VÁCUO (vizinho público genuíno) provando que
 * a query realmente alcançaria esses vizinhos se não fossem barrados pelo gate.
 */
const DIM = 1536

/** Vetor unitário no plano e1–e2 com cosseno EXATO `c` vs a base (e1). */
function vecCos(c: number): number[] {
  const v = new Array<number>(DIM).fill(0)
  v[0] = c
  v[1] = Math.sqrt(Math.max(0, 1 - c * c))
  return v
}
const BASE_VEC = (() => {
  const v = new Array<number>(DIM).fill(0)
  v[0] = 1
  return v
})()

async function seedBase(): Promise<string> {
  const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Receita base', provenance: 'escrita_por_pessoa' })
  await seedEmbedding({ recipeId, locale: 'pt-BR', embedding: BASE_VEC, model: 'test' })
  return recipeId
}

async function seedCandidate(input: {
  cos: number
  titulo: string
  origin?: Origin
  visibility?: Visibility
  ownerId?: string | null
  curationStatus?: CurationStatus
  resultKind?: ResultKind
  locale?: string
}): Promise<string> {
  const locale = input.locale ?? 'pt-BR'
  const recipeId = await seedRecipe({
    origin: input.origin ?? 'catalog',
    originalLocale: locale,
    visibility: input.visibility,
    ownerId: input.ownerId ?? null,
    curationStatus: input.curationStatus,
    resultKind: input.resultKind,
  })
  await seedTranslation({ recipeId, locale, titulo: input.titulo, provenance: 'escrita_por_pessoa' })
  await seedEmbedding({ recipeId, locale, embedding: vecCos(input.cos), model: 'test' })
  return recipeId
}

function ids(rows: { recipe_id: string }[]): string[] {
  return rows.map((r) => r.recipe_id)
}

describe('loadSimilarRecipes (#454) — vizinhos por cosseno + gates de pool', () => {
  it('vizinho PÚBLICO forte aparece; vizinho fraco (abaixo do piso) não aparece', async () => {
    const db = getDb()
    const base = await seedBase()
    const strong = await seedCandidate({ cos: 0.9, titulo: 'Vizinho forte' })
    const weak = await seedCandidate({ cos: 0.1, titulo: 'Vizinho fraco' })

    const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
    expect(ids(rows)).toContain(strong)
    expect(ids(rows)).not.toContain(weak)
  })

  it('sem embedding próprio no locale pedido ⇒ devolve [] (nunca lança)', async () => {
    const db = getDb()
    const recipeId = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR' })
    await seedTranslation({ recipeId, locale: 'pt-BR', titulo: 'Sem embedding', provenance: 'escrita_por_pessoa' })
    // Sem seedEmbedding — a receita não tem vetor próprio ainda.
    await seedCandidate({ cos: 0.9, titulo: 'Vizinho forte (irrelevante)' })

    const rows = await loadSimilarRecipes(db, { recipeId, locale: 'pt-BR' })
    expect(rows).toEqual([])
  })

  it('exclui a PRÓPRIA receita-base do resultado (mesmo com embedding no locale)', async () => {
    const db = getDb()
    const base = await seedBase()
    const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
    expect(ids(rows)).not.toContain(base)
  })

  it('respeita o LIMIT (default 4), ordenado por cosseno DESC', async () => {
    const db = getDb()
    const base = await seedBase()
    const cossenos = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7]
    const seeded: string[] = []
    for (const c of cossenos) {
      seeded.push(await seedCandidate({ cos: c, titulo: `Vizinho ${c}` }))
    }

    const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
    expect(rows).toHaveLength(SIMILAR_RECIPES_LIMIT)
    // Os 4 primeiros (maior cosseno) — os dois últimos (0.75/0.7) ficam de fora.
    expect(ids(rows)).toEqual(seeded.slice(0, SIMILAR_RECIPES_LIMIT))
  })

  it('candidato com embedding SÓ em outro locale ainda é alcançado (dedup não exige mesmo locale)', async () => {
    const db = getDb()
    const base = await seedBase()
    const enOnly = await seedCandidate({ cos: 0.9, titulo: 'Neighbor EN only', locale: 'en-US' })
    const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
    expect(ids(rows)).toContain(enOnly)
  })

  describe('NÃO-VAZAMENTO (inegociável, ADR-0026/#238) — mesmos 4 gates de eligibleForPool', () => {
    it('receita PRIVADA de outro dono, mesmo com cosseno forte, NUNCA aparece', async () => {
      const db = getDb()
      const base = await seedBase()
      const ownerId = await seedUser({ email: `sim-priv-${crypto.randomUUID()}@ex.com` })
      const priv = await seedCandidate({
        cos: 0.95,
        titulo: 'Receita privada forte',
        origin: 'ai_chat',
        visibility: 'private',
        ownerId,
        curationStatus: 'not_required',
      })
      // Controle NÃO-VÁCUO: um vizinho público genuíno prova que a query alcançaria a privada
      // SE ela não fosse barrada pelo gate (não é ausência de resultado por outro motivo).
      const control = await seedCandidate({ cos: 0.9, titulo: 'Controle público' })

      const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
      expect(ids(rows)).toContain(control)
      expect(ids(rows)).not.toContain(priv)
    })

    it('receita MODERADA (moderation_removed_at), mesmo PÚBLICA e com cosseno forte, NUNCA aparece', async () => {
      const db = getDb()
      const base = await seedBase()
      const curatorId = await seedUser({ email: `sim-curator-${crypto.randomUUID()}@ex.com`, role: 'curador' })
      const ownerId = await seedUser({ email: `sim-mod-owner-${crypto.randomUUID()}@ex.com` })
      const moderated = await seedCandidate({
        cos: 0.95,
        titulo: 'Receita moderada forte',
        origin: 'ai_chat',
        visibility: 'public',
        ownerId,
        curationStatus: 'not_required',
      })
      await seedRemovedFromPool({ recipeId: moderated, curatorId })
      const control = await seedCandidate({ cos: 0.9, titulo: 'Controle público 2' })

      const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
      expect(ids(rows)).toContain(control)
      expect(ids(rows)).not.toContain(moderated)
    })

    it('CATÁLOGO PENDENTE de curadoria (curationStatus≠approved), mesmo cosseno forte, NUNCA aparece', async () => {
      const db = getDb()
      const base = await seedBase()
      const pending = await seedCandidate({
        cos: 0.95,
        titulo: 'Rascunho de catálogo forte',
        origin: 'catalog',
        curationStatus: 'pending',
      })
      const control = await seedCandidate({ cos: 0.9, titulo: 'Controle público 3' })

      const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
      expect(ids(rows)).toContain(control)
      expect(ids(rows)).not.toContain(pending)
    })

    it('receita IMPORTADA DA WEB (web_imported), mesmo cosseno forte, NUNCA aparece', async () => {
      const db = getDb()
      const base = await seedBase()
      const ownerId = await seedUser({ email: `sim-web-${crypto.randomUUID()}@ex.com` })
      // web_imported É SEMPRE private (CHECK recipe_web_imported_private_chk, #450) — o cinto E a
      // suspensório: mesmo que o gate de visibilidade já a barrasse, o predicado explícito
      // `origin <> 'web_imported'` do loader é testado aqui também (defense-in-depth).
      const imported = await seedCandidate({
        cos: 0.95,
        titulo: 'Receita importada forte',
        origin: 'web_imported',
        visibility: 'private',
        ownerId,
        curationStatus: 'not_required',
      })
      const control = await seedCandidate({ cos: 0.9, titulo: 'Controle público 4' })

      const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
      expect(ids(rows)).toContain(control)
      expect(ids(rows)).not.toContain(imported)
    })

    it('receita PLAYFUL (resultKind), mesmo PÚBLICA e com cosseno forte, NUNCA aparece', async () => {
      const db = getDb()
      const base = await seedBase()
      // playful = resultado "brincalhão" da geração (ex. pedido non-sense) — nunca entra no pool,
      // mesmo público e curado (5º eixo de `eligibleForPool`, sem teste dedicado até este achado
      // de code-review; os outros 4 já tinham cobertura).
      const playful = await seedCandidate({
        cos: 0.95,
        titulo: 'Receita playful forte',
        origin: 'catalog',
        resultKind: 'playful',
      })
      const control = await seedCandidate({ cos: 0.9, titulo: 'Controle público 5' })

      const rows = await loadSimilarRecipes(db, { recipeId: base, locale: 'pt-BR' })
      expect(ids(rows)).toContain(control)
      expect(ids(rows)).not.toContain(playful)
    })
  })
})
