import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  VOCABULARY_KINDS,
  VOCABULARY_TERM_STATUSES,
  isVocabularyKind,
  isVocabularyTermStatus,
  COZINHA_SEED,
} from '@/domain/vocabulary-term'
import { COZINHAS } from '@/domain/vocabulary'

/**
 * Kernel da tabela `vocabulary_term` (issue #314, ADR-0025 Fatia A). Puro — sem DB.
 * `kind` e `status` ficam no código (meta-nível); QUAIS cozinhas existem vira dado
 * (a seed). Aqui provamos os enums congelados + os guards + a integridade da seed
 * que a migração/helper copiam (fonte única).
 */

describe('vocabulary-term: enums de meta-nível', () => {
  it('VOCABULARY_TERM_STATUSES é a lista congelada (ordem importa p/ o pgEnum)', () => {
    expect(VOCABULARY_TERM_STATUSES).toEqual([
      'suggested',
      'active',
      'deprecated',
      'merged',
      'rejected',
    ])
  })

  it('VOCABULARY_KINDS começa só com cozinha (ADR-0025: categoria/unidade ficam fechadas)', () => {
    expect(VOCABULARY_KINDS).toEqual(['cozinha'])
  })

  it('isVocabularyTermStatus aceita os válidos e rejeita o resto', () => {
    expect(isVocabularyTermStatus('active')).toBe(true)
    expect(isVocabularyTermStatus('suggested')).toBe(true)
    expect(isVocabularyTermStatus('bogus')).toBe(false)
    expect(isVocabularyTermStatus('')).toBe(false)
  })

  it('isVocabularyKind aceita cozinha e rejeita o resto', () => {
    expect(isVocabularyKind('cozinha')).toBe(true)
    expect(isVocabularyKind('x')).toBe(false)
  })
})

describe('vocabulary-term: COZINHA_SEED (fonte única da migração/helper)', () => {
  it('tem exatamente 15 entradas (14 atuais + americana)', () => {
    expect(COZINHA_SEED).toHaveLength(15)
  })

  it('cobre TODOS os slugs de COZINHAS (guard de drift com o enum atual)', () => {
    const seedSlugs = new Set(COZINHA_SEED.map((t) => t.slug))
    for (const slug of COZINHAS) {
      expect(seedSlugs.has(slug)).toBe(true)
    }
  })

  it('inclui americana (destrava o seed de catálogo #238)', () => {
    expect(COZINHA_SEED.some((t) => t.slug === 'americana')).toBe(true)
  })

  it('slugs são únicos (a tabela impõe UNIQUE(slug))', () => {
    const slugs = COZINHA_SEED.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('toda linha tem labelPtBr E labelEnUs não-vazios', () => {
    for (const t of COZINHA_SEED) {
      expect(t.labelPtBr.trim().length).toBeGreaterThan(0)
      expect(t.labelEnUs.trim().length).toBeGreaterThan(0)
    }
  })
})

/**
 * Paridade do INSERT escrito À MÃO em drizzle/0033_*.sql com a fonte única COZINHA_SEED.
 * drizzle-kit não emite dados — o INSERT é hand-appended, então um slug/label/sort digitado
 * errado divergiria silenciosamente. Este guard automatiza o "grep para confirmar" do plano:
 * cada linha (kind/slug/status/labels/sort, acentos inclusive) tem de aparecer no .sql.
 */
describe('vocabulary-term: paridade do INSERT da migração 0033', () => {
  const drizzleUrl = new URL('../../drizzle/', import.meta.url)

  function read0033(): string {
    const dir = fileURLToPath(drizzleUrl)
    const file = readdirSync(dir).find((name) => /^0033_.*\.sql$/.test(name))
    expect(file, 'arquivo 0033_*.sql deve existir').toBeDefined()
    return readFileSync(new URL(file!, drizzleUrl), 'utf8')
  }

  const squish = (s: string) => s.replace(/\s+/g, ' ').trim()

  it('cada uma das 15 linhas do seed está no .sql, byte-espelho de COZINHA_SEED', () => {
    const normalized = squish(read0033())
    for (const t of COZINHA_SEED) {
      const row = squish(
        `('cozinha', '${t.slug}', 'active', '${t.labelPtBr}', '${t.labelEnUs}', ${t.sort})`,
      )
      expect(normalized).toContain(row)
    }
  })
})
