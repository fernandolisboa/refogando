import { describe, expect, it } from 'vitest'
import { loadActiveCozinhaSlugs } from '@/server/vocabulary/active-set'
import { getDb } from '@/server/deps'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'
import { COZINHA_SEED } from '@/domain/vocabulary-term'
import { vocabularyTerm } from '@/db/schema'

/**
 * Leitor DB-DIRETO `loadActiveCozinhaSlugs` (#316, ADR-0025 Decisão 4) contra Postgres real
 * (node project). Espelha o setup de `vocabulary-load.test.ts`, mas SEM mexer no cache do
 * `loadVocabulary` — este leitor lê o DB direto (sem cache), então não há Map a limpar.
 *
 * LANDMINE: `truncateAll` (test/setup.ts) apaga as LINHAS num beforeEach global ANTES de cada
 * teste, então cada caso re-semeia via `seedVocabularyCozinhas` (+ inserts manuais com slugs
 * GLOBALMENTE únicos).
 */

const ALL_ACTIVE_SLUGS = COZINHA_SEED.map((t) => t.slug)

// Helper LOCAL (não compartilhado): insere uma linha avulsa com status arbitrário.
async function insertTerm(opts: {
  slug: string
  status: 'suggested' | 'active' | 'deprecated' | 'merged' | 'rejected'
  sort?: number
}) {
  await getDb()
    .insert(vocabularyTerm)
    .values({
      kind: 'cozinha',
      slug: opts.slug,
      status: opts.status,
      sort: opts.sort ?? 99,
      labelPtBr: opts.slug,
      labelEnUs: opts.slug,
    })
}

describe('loadActiveCozinhaSlugs (#316) — conjunto ATIVO DB-direto', () => {
  it('retorna EXATAMENTE os 15 slugs ativos (inclui americana, NÃO enum-limitado)', async () => {
    await seedVocabularyCozinhas(getDb())

    const set = await loadActiveCozinhaSlugs(getDb())
    // O leitor é DB-direto, NÃO enum-bounded: 'americana' (ativa-mas-não-no-enum) ESTÁ no conjunto.
    expect([...set].sort()).toEqual([...ALL_ACTIVE_SLUGS].sort())
    expect(set.has('americana')).toBe(true)
    expect(set.size).toBe(15)
  })

  it('EXCLUI deprecated/suggested (e qualquer não-active)', async () => {
    await seedVocabularyCozinhas(getDb())
    await insertTerm({ slug: 'depr', status: 'deprecated' })
    await insertTerm({ slug: 'sugg', status: 'suggested' })

    const set = await loadActiveCozinhaSlugs(getDb())
    expect(set.has('depr')).toBe(false)
    expect(set.has('sugg')).toBe(false)
    expect(set.size).toBe(15)
  })
})
