import { describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { vocabularyTerm } from '@/db/schema'
import { suggestCozinha } from '@/server/vocabulary/suggest'

/**
 * Matriz de dedup do `suggestCozinha` (#319, ADR-0025 Decisão 5) contra Postgres real (node).
 * `test/setup.ts` re-semeia as 15 cozinhas ATIVAS num beforeEach global, então o baseline já tem
 * `italiana` etc. ativas; o `deprecated` é auto-semeado pelo próprio caso (o baseline não tem).
 */

async function countTerms(slug: string): Promise<number> {
  const rows = await getDb()
    .select({ slug: vocabularyTerm.slug })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
  return rows.length
}

async function totalTerms(): Promise<number> {
  const rows = await getDb().select({ slug: vocabularyTerm.slug }).from(vocabularyTerm)
  return rows.length
}

async function statusOf(slug: string): Promise<string | undefined> {
  const [row] = await getDb()
    .select({ status: vocabularyTerm.status })
    .from(vocabularyTerm)
    .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, slug)))
  return row?.status
}

describe('suggestCozinha (#319) — dedup na entrada + termo suggested', () => {
  it('(1) ATIVA: reusa o slug existente, NÃO cria linha nova', async () => {
    const before = await totalTerms()
    const slug = await suggestCozinha(getDb(), 'Italiana')
    expect(slug).toBe('italiana')
    expect(await countTerms('italiana')).toBe(1)
    expect(await statusOf('italiana')).toBe('active') // não rebaixou
    expect(await totalTerms()).toBe(before) // nenhuma linha nova
  })

  it('(2) DEPRECATED: reusa o slug, não insere', async () => {
    await getDb()
      .insert(vocabularyTerm)
      .values({ kind: 'cozinha', slug: 'caipira', status: 'deprecated', labelPtBr: 'Caipira' })
    const before = await totalTerms()

    const slug = await suggestCozinha(getDb(), 'Caipira')
    expect(slug).toBe('caipira')
    expect(await countTerms('caipira')).toBe(1)
    expect(await statusOf('caipira')).toBe('deprecated') // intacto
    expect(await totalTerms()).toBe(before)
  })

  it('(3) SUGGESTED multi-owner: duas chamadas (donos distintos) anexam — exatamente 1 linha', async () => {
    const a = await suggestCozinha(getDb(), 'Georgiana', 'owner-a')
    const b = await suggestCozinha(getDb(), 'Georgiana', 'owner-b')
    expect(a).toBe('georgiana')
    expect(b).toBe('georgiana')
    expect(await countTerms('georgiana')).toBe(1)
    expect(await statusOf('georgiana')).toBe('suggested')
  })

  it('(4) NOVA: insere status=suggested, labels NULL, kind cozinha', async () => {
    const slug = await suggestCozinha(getDb(), 'Etíope')
    expect(slug).toBe('etiope')
    const [row] = await getDb()
      .select()
      .from(vocabularyTerm)
      .where(and(eq(vocabularyTerm.kind, 'cozinha'), eq(vocabularyTerm.slug, 'etiope')))
    expect(row.status).toBe('suggested')
    expect(row.labelPtBr).toBeNull()
    expect(row.labelEnUs).toBeNull()
    expect(row.kind).toBe('cozinha')
  })

  it('(5) NORMALIZAÇÃO: "Comida Georgiana!" e "comida georgiana" dobram para o mesmo slug', async () => {
    const a = await suggestCozinha(getDb(), 'Comida Georgiana!')
    const b = await suggestCozinha(getDb(), 'comida georgiana')
    expect(a).toBe('comida-georgiana')
    expect(b).toBe('comida-georgiana')
    expect(await countTerms('comida-georgiana')).toBe(1)
  })

  it('(6) GUARDA DE VAZIO: "!!!" e "   " ⇒ null, sem inserir nada', async () => {
    const before = await totalTerms()
    expect(await suggestCozinha(getDb(), '!!!')).toBeNull()
    expect(await suggestCozinha(getDb(), '   ')).toBeNull()
    expect(await totalTerms()).toBe(before)
  })

  it('(7) IDEMPOTENTE: chamar duas vezes não estoura a UNIQUE', async () => {
    const a = await suggestCozinha(getDb(), 'Coreana do Sul')
    const b = await suggestCozinha(getDb(), 'Coreana do Sul')
    expect(a).toBe('coreana-do-sul')
    expect(b).toBe('coreana-do-sul')
    expect(await countTerms('coreana-do-sul')).toBe(1)
  })
})
