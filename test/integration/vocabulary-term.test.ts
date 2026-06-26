import { describe, expect, it, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { vocabularyTerm } from '@/db/schema'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'

/**
 * Tabela `vocabulary_term` (#314, ADR-0025 Fatia A passo 1) contra Postgres real.
 *
 * `test/setup.ts` faz `truncateAll` num beforeEach global ANTES deste — então o seed de
 * deploy da migração já foi apagado; re-semeamos via `seedVocabularyCozinhas` (o ponto do
 * helper). Provamos as propriedades de DADOS: 15 termos ativos de cozinha com labels
 * não-nulos, sort denso/crescente, e a UNIQUE(slug) — prova de que a constraint é REAL
 * (referenciável por FK na #318), não só um índice.
 */
beforeEach(async () => {
  await seedVocabularyCozinhas(getDb())
})

describe('vocabulary_term — seed de cozinha', () => {
  it('semeia 15 termos, todos kind=cozinha / status=active com labels não-nulos', async () => {
    const rows = await getDb().select().from(vocabularyTerm)
    expect(rows).toHaveLength(15)
    for (const row of rows) {
      expect(row.kind).toBe('cozinha')
      expect(row.status).toBe('active')
      expect(row.labelPtBr).toBeTruthy()
      expect(row.labelEnUs).toBeTruthy()
    }
  })

  it('sort é estritamente crescente e distinto (0..14)', async () => {
    const rows = await getDb().select().from(vocabularyTerm).orderBy(vocabularyTerm.sort)
    expect(rows.map((r) => r.sort)).toEqual([...Array(15).keys()])
  })

  it('inserir slug já existente viola a UNIQUE(slug) — constraint real, alvo de FK (#318)', async () => {
    await expect(
      getDb()
        .insert(vocabularyTerm)
        .values({ kind: 'cozinha', slug: 'italiana', status: 'active' }),
    ).rejects.toThrow()
  })

  it('re-semear é idempotente (onConflictDoNothing) — segue com 15 linhas', async () => {
    await seedVocabularyCozinhas(getDb())
    const rows = await getDb()
      .select()
      .from(vocabularyTerm)
      .where(eq(vocabularyTerm.kind, 'cozinha'))
    expect(rows).toHaveLength(15)
  })
})
