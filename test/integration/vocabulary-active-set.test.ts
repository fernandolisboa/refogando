import { describe, expect, it } from 'vitest'
import { loadActiveCozinhaSlugs, loadCozinhaVoice } from '@/server/vocabulary/active-set'
import { getDb } from '@/server/deps'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'
import { COZINHA_SEED } from '@/domain/vocabulary-term'
import { vocabularyTerm } from '@/db/schema'

/**
 * Leitor DB-DIRETO `loadActiveCozinhaSlugs` (#316, ADR-0025 Decisão 4) contra Postgres real
 * (node project). Espelha o setup de `vocabulary-load.test.ts`, mas SEM mexer no cache do
 * `loadVocabulary` — este leitor lê o DB direto (sem cache), então não há Map a limpar.
 *
 * LANDMINE: o `test/setup.ts` faz um BASELINE-RESEED do `COZINHA_SEED` (as 15 cozinhas base)
 * num beforeEach global ANTES de cada teste. Logo os slugs do seed (baiana, coreana, ...) JÁ
 * existem quando o teste roda — por isso `insertTerm` é UPSERT (onConflictDoUpdate por slug):
 * setar a nota/rótulo de uma cozinha já semeada não pode colidir com a unique de slug.
 */

const ALL_ACTIVE_SLUGS = COZINHA_SEED.map((t) => t.slug)

// Helper LOCAL (não compartilhado): garante uma linha com status/rótulo/nota arbitrários.
// UPSERT por slug — robusto ao baseline-reseed (slug do seed já existe → atualiza; senão insere).
async function insertTerm(opts: {
  slug: string
  status: 'suggested' | 'active' | 'deprecated' | 'merged' | 'rejected'
  sort?: number
  labelPtBr?: string | null
  voiceNote?: string | null
}) {
  const values = {
    kind: 'cozinha' as const,
    slug: opts.slug,
    status: opts.status,
    sort: opts.sort ?? 99,
    labelPtBr: opts.labelPtBr === undefined ? opts.slug : opts.labelPtBr,
    labelEnUs: opts.slug,
    voiceNote: opts.voiceNote ?? null,
  }
  await getDb()
    .insert(vocabularyTerm)
    .values(values)
    .onConflictDoUpdate({
      target: vocabularyTerm.slug,
      set: {
        status: values.status,
        sort: values.sort,
        labelPtBr: values.labelPtBr,
        labelEnUs: values.labelEnUs,
        voiceNote: values.voiceNote,
      },
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

describe('loadCozinhaVoice (#422) — voz da cozinha DB-direto', () => {
  it('nome = rótulo pt-BR + a nota de voz curada quando existe', async () => {
    await insertTerm({
      slug: 'baiana',
      status: 'active',
      labelPtBr: 'Baiana',
      voiceNote: 'Use dendê e leite de coco.',
    })

    const voz = await loadCozinhaVoice(getDb(), 'baiana')
    expect(voz).toEqual({ nome: 'Baiana', voiceNote: 'Use dendê e leite de coco.' })
  })

  it("QUALQUER status casa — inclusive 'suggested' (vinda de \"Outra\")", async () => {
    await insertTerm({ slug: 'nordestina', status: 'suggested', labelPtBr: null, voiceNote: null })

    const voz = await loadCozinhaVoice(getDb(), 'nordestina')
    // Sem rótulo pt-BR ⇒ nome cai no slug (fallback); nota ausente ⇒ null (só o genérico dispara).
    expect(voz).toEqual({ nome: 'nordestina', voiceNote: null })
  })

  it('sem rótulo pt-BR ⇒ nome cai no slug (fallback)', async () => {
    await insertTerm({ slug: 'coreana', status: 'active', labelPtBr: null, voiceNote: 'Fermentados e gochujang.' })

    const voz = await loadCozinhaVoice(getDb(), 'coreana')
    expect(voz).toEqual({ nome: 'coreana', voiceNote: 'Fermentados e gochujang.' })
  })

  it('slug inexistente ⇒ null', async () => {
    expect(await loadCozinhaVoice(getDb(), 'inexistente')).toBeNull()
  })
})
