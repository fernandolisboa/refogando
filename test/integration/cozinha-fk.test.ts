import { describe, expect, it, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { recipe, briefing } from '@/db/schema'
import { pgCode } from '@/server/recipe/visibility'
import { seedRecipe } from '../helpers/recipes'
import { seedBriefing } from '../helpers/generation'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'

/**
 * A VIRADA #318 (ADR-0025): `recipe.cozinha`/`briefing.cozinha` saíram do pgEnum `cozinha` e
 * viraram `text` com FK p/ `vocabulary_term.slug` (ON DELETE RESTRICT). Aqui provamos o
 * INVARIANTE DE BANCO direto pela porta de dados:
 *  - um slug FORA do vocabulário é REJEITADO na escrita (FK violation 23503), não 22P02/aceito;
 *  - toda cozinha ATIVA (inclusive 'americana', que era ativa-mas-não-no-enum) é aceita;
 *  - NULL é aceito (a FK não exige presença).
 *
 * `test/setup.ts` reseed as 15 cozinhas ativas num beforeEach global (espelha o prod, onde a
 * migração 0033 nunca deixa a tabela vazia); re-semeamos aqui também (idempotente) por clareza.
 */
beforeEach(async () => {
  await seedVocabularyCozinhas(getDb())
})

describe('recipe.cozinha — FK p/ vocabulary_term.slug (#318)', () => {
  it('slug FORA do vocabulário → rejeitado na escrita (FK 23503)', async () => {
    try {
      await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha: 'naoexiste' })
      throw new Error('inserir cozinha inexistente deveria ter violado a FK')
    } catch (err) {
      expect(pgCode(err)).toBe('23503')
    }
  })

  it("cozinha ativa ('italiana'), 'americana' (data-driven) e NULL → todas aceitas", async () => {
    for (const cozinha of ['italiana', 'americana', null] as const) {
      const id = await seedRecipe({ origin: 'catalog', originalLocale: 'pt-BR', ownerId: null, cozinha })
      const [row] = await getDb().select({ cozinha: recipe.cozinha }).from(recipe).where(eq(recipe.id, id))
      expect(row.cozinha).toBe(cozinha)
    }
  })
})

describe('briefing.cozinha — FK p/ vocabulary_term.slug (#318)', () => {
  it('slug FORA do vocabulário → rejeitado na escrita (FK 23503)', async () => {
    try {
      await seedBriefing({ cozinha: 'naoexiste' })
      throw new Error('inserir cozinha inexistente deveria ter violado a FK')
    } catch (err) {
      expect(pgCode(err)).toBe('23503')
    }
  })

  it("cozinha ativa ('italiana'), 'americana' e NULL → todas aceitas", async () => {
    for (const cozinha of ['italiana', 'americana', null] as const) {
      const id = await seedBriefing({ cozinha })
      const [row] = await getDb().select({ cozinha: briefing.cozinha }).from(briefing).where(eq(briefing.id, id))
      expect(row.cozinha).toBe(cozinha)
    }
  })
})
