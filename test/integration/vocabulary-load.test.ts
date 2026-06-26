import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  __clearVocabularyCache,
  loadVocabulary,
  VOCABULARY_SCOPES,
  type VocabularyTermView,
} from '@/server/vocabulary/load'
import { getDb } from '@/server/deps'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'
import { COZINHA_SEED } from '@/domain/vocabulary-term'
import { vocabularyTerm } from '@/db/schema'

/**
 * Leitor `loadVocabulary` (#315, ADR-0025 Decisão 4) contra Postgres real (node project).
 *
 * LANDMINE: o cache do módulo é um Map em memória — `truncateAll` (test/setup.ts) apaga as
 * LINHAS num beforeEach global, mas NÃO o Map. Por isso limpamos o cache no beforeEach E no
 * afterEach locais (o hook global não conhece o nosso Map). Cada caso re-semeia via
 * `seedVocabularyCozinhas` + inserts manuais (kind 'cozinha', slugs GLOBALMENTE únicos).
 */

const ACTIVE_SLUGS_IN_SORT = [...COZINHA_SEED]
  .sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
  .map((t) => t.slug)

beforeEach(() => __clearVocabularyCache())
afterEach(() => __clearVocabularyCache())

async function insertTerm(opts: {
  slug: string
  status: 'suggested' | 'active' | 'deprecated' | 'merged' | 'rejected'
  sort: number
  labelPtBr?: string | null
  labelEnUs?: string | null
}) {
  await getDb()
    .insert(vocabularyTerm)
    .values({
      kind: 'cozinha',
      slug: opts.slug,
      status: opts.status,
      sort: opts.sort,
      // distingue "não passado" (usa o slug) de null EXPLÍCITO (caso dos rótulos crus).
      labelPtBr: opts.labelPtBr === undefined ? opts.slug : opts.labelPtBr,
      labelEnUs: opts.labelEnUs === undefined ? opts.slug : opts.labelEnUs,
    })
}

describe('loadVocabulary (#315) — leitor por status/superfície', () => {
  it("scope='active' retorna SÓ active, ordenado por sort; sem vazar id/status/timestamps", async () => {
    await seedVocabularyCozinhas(getDb())
    await insertTerm({ slug: 'depr', status: 'deprecated', sort: 99 })
    await insertTerm({ slug: 'sugg', status: 'suggested', sort: 98 })

    const rows = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(rows.map((r) => r.slug)).toEqual(ACTIVE_SLUGS_IN_SORT)
    expect(rows.map((r) => r.slug)).not.toContain('depr')
    expect(rows.map((r) => r.slug)).not.toContain('sugg')
    // Allowlist de colunas: a view não carrega id/status/timestamps.
    expect(Object.keys(rows[0]).sort()).toEqual(['labelEnUs', 'labelPtBr', 'slug', 'sort'])
  })

  it("scope='display' inclui active+deprecated, exclui suggested/merged/rejected", async () => {
    await seedVocabularyCozinhas(getDb())
    await insertTerm({ slug: 'd-depr', status: 'deprecated', sort: 90 })
    await insertTerm({ slug: 'd-sugg', status: 'suggested', sort: 91 })
    await insertTerm({ slug: 'd-merged', status: 'merged', sort: 92 })
    await insertTerm({ slug: 'd-rej', status: 'rejected', sort: 93 })

    const rows = await loadVocabulary(getDb(), 'cozinha', 'display')
    const slugs = rows.map((r) => r.slug)
    expect(slugs).toContain('d-depr')
    expect(slugs).not.toContain('d-sugg')
    expect(slugs).not.toContain('d-merged')
    expect(slugs).not.toContain('d-rej')
    // a depreciada entra na ordenação mesclada no SEU slot de sort (90 → por último).
    const expected = [
      ...COZINHA_SEED.map((t) => ({ slug: t.slug, sort: t.sort })),
      { slug: 'd-depr', sort: 90 },
    ].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
    expect(rows.map((r) => ({ slug: r.slug, sort: r.sort }))).toEqual(expected)
  })

  it('ordena por sort asc e desempata por slug asc (resultado completo)', async () => {
    await seedVocabularyCozinhas(getDb())
    // inseridos fora de ordem + um par de mesmo sort p/ provar o desempate por slug.
    await insertTerm({ slug: 'z-mid', status: 'active', sort: 50 })
    await insertTerm({ slug: 'a-low', status: 'active', sort: 25 })
    await insertTerm({ slug: 'b-tie', status: 'active', sort: 25 })
    await insertTerm({ slug: 'a-tie', status: 'active', sort: 25 })

    const rows = await loadVocabulary(getDb(), 'cozinha', 'active')
    const expected = [
      ...COZINHA_SEED.map((t) => ({ slug: t.slug, sort: t.sort })),
      { slug: 'z-mid', sort: 50 },
      { slug: 'a-low', sort: 25 },
      { slug: 'b-tie', sort: 25 },
      { slug: 'a-tie', sort: 25 },
    ].sort((a, b) => a.sort - b.sort || a.slug.localeCompare(b.slug))
    expect(rows.map((r) => ({ slug: r.slug, sort: r.sort }))).toEqual(expected)
  })

  it('retorna rótulos crus, inclusive null (sem fallback — isso é #317)', async () => {
    await insertTerm({ slug: 'sem-rotulo', status: 'active', sort: 5, labelPtBr: null, labelEnUs: null })

    const rows = await loadVocabulary(getDb(), 'cozinha', 'active')
    const row = rows.find((r) => r.slug === 'sem-rotulo')
    expect(row).toBeDefined()
    expect(row?.labelPtBr).toBeNull()
    expect(row?.labelEnUs).toBeNull()
  })

  it('cache é real dentro do TTL; __clearVocabularyCache força leitura fresca', async () => {
    await seedVocabularyCozinhas(getDb())
    const first = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(first.map((r) => r.slug)).toContain('italiana')

    // Mutação direta no DB DEPOIS de popular o cache: o snapshot deve seguir IGUAL (cache hit).
    await getDb()
      .update(vocabularyTerm)
      .set({ status: 'deprecated' })
      .where(eq(vocabularyTerm.slug, 'italiana'))
    const cached = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(cached.map((r) => r.slug)).toContain('italiana')

    // Limpando o cache, a leitura fresca já reflete a desativação.
    __clearVocabularyCache()
    const fresh = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(fresh.map((r) => r.slug)).not.toContain('italiana')
  })

  it('chaves de cache por kind:scope são independentes (active não contamina display)', async () => {
    await seedVocabularyCozinhas(getDb())
    await loadVocabulary(getDb(), 'cozinha', 'active') // popula a chave cozinha:active
    await insertTerm({ slug: 'depr2', status: 'deprecated', sort: 80 })

    const display = (await loadVocabulary(getDb(), 'cozinha', 'display')).map((r) => r.slug)
    expect(display).toContain('depr2')
  })

  it('snapshot é congelado: mutar o resultado não envenena o cache compartilhado', async () => {
    await seedVocabularyCozinhas(getDb())
    const first = await loadVocabulary(getDb(), 'cozinha', 'active')

    // array e linhas congelados → mutação acidental falha no ponto de chamada (strict mode).
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first[0])).toBe(true)
    expect(() => (first as VocabularyTermView[]).reverse()).toThrow()
    expect(() => {
      ;(first[0] as VocabularyTermView).slug = 'mutado'
    }).toThrow()

    // o segundo chamador (cache hit dentro do TTL) recebe o snapshot intacto.
    const second = await loadVocabulary(getDb(), 'cozinha', 'active')
    expect(second.map((r) => r.slug)).toEqual(first.map((r) => r.slug))
    expect(second.map((r) => r.slug)).not.toContain('mutado')
  })

  it('VOCABULARY_SCOPES expõe exatamente active e display', () => {
    expect(Object.keys(VOCABULARY_SCOPES).sort()).toEqual(['active', 'display'])
    expect([...VOCABULARY_SCOPES.active]).toEqual(['active'])
    expect([...VOCABULARY_SCOPES.display]).toEqual(['active', 'deprecated'])
  })
})
