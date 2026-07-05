import { describe, expect, it } from 'vitest'
import { computeTranslationFingerprintBackfill, type BackfillCandidateRow, type BackfillSourceFields } from '@/domain/translation-fingerprint-backfill'
import { fingerprintSource, fingerprintMt } from '@/domain/translation-fingerprint'

// Regra de seleção/construção do backfill (#501, ADR-0031 dec.7 — migração agressiva). Testa SÓ a
// lógica pura (sem banco): quando cada fingerprint é preenchido e a partir de QUAIS campos — os
// hashes em si já são cobertos byte-a-byte em `translation-fingerprint.test.ts` (#496).

const source: BackfillSourceFields = {
  titulo: 'Feijoada',
  descricao: 'Um ensopado.',
  passos: ['Refogue', 'Cozinhe'],
  notas: 'Sirva com arroz.',
  ingredientes: [
    { ordem: 0, nome: 'feijão preto' },
    { ordem: 1, nome: 'linguiça' },
  ],
}

const baseRow: BackfillCandidateRow = {
  provenance: 'automatica_nao_revisada',
  sourceFingerprint: null,
  mtFingerprint: null,
  titulo: 'Feijoada',
  descricao: 'A stew.',
  passos: ['Sauté', 'Simmer'],
  notas: 'Serve with rice.',
  ingredientes: [
    { ordem: 0, nome: 'black beans', nomeOrigem: 'feijão preto' },
    { ordem: 1, nome: 'sausage', nomeOrigem: 'linguiça' },
  ],
}

describe('computeTranslationFingerprintBackfill (#501)', () => {
  it('preenche source_fingerprint quando ainda NULL, IGUAL a fingerprintSource(fonte)', () => {
    const update = computeTranslationFingerprintBackfill(baseRow, source)
    expect(update.sourceFingerprint).toBe(
      fingerprintSource({
        titulo: source.titulo,
        descricao: source.descricao,
        passos: source.passos,
        notas: source.notas,
        ingredientes: source.ingredientes,
      }),
    )
  })

  it('preenche mt_fingerprint só em automatica_nao_revisada, IGUAL a fingerprintMt(conteúdo da linha)', () => {
    const update = computeTranslationFingerprintBackfill(baseRow, source)
    expect(update.mtFingerprint).toBe(
      fingerprintMt({
        titulo: baseRow.titulo,
        descricao: baseRow.descricao,
        passos: baseRow.passos,
        notas: baseRow.notas,
        ingredientes: [
          { ordem: 0, nome: 'black beans' },
          { ordem: 1, nome: 'sausage' },
        ],
      }),
    )
  })

  it('NUNCA preenche mt_fingerprint em automatica_revisada (confiável, protegida)', () => {
    const revisada: BackfillCandidateRow = { ...baseRow, provenance: 'automatica_revisada' }
    const update = computeTranslationFingerprintBackfill(revisada, source)
    expect(update.mtFingerprint).toBeUndefined()
    // source_fingerprint ainda é preenchido — a confiável cai na lista do Curador se driftar.
    expect(update.sourceFingerprint).toBeDefined()
  })

  it('NUNCA preenche mt_fingerprint em escrita_por_pessoa (confiável, protegida)', () => {
    const pessoa: BackfillCandidateRow = { ...baseRow, provenance: 'escrita_por_pessoa' }
    const update = computeTranslationFingerprintBackfill(pessoa, source)
    expect(update.mtFingerprint).toBeUndefined()
    expect(update.sourceFingerprint).toBeDefined()
  })

  it('NÃO recalcula source_fingerprint se já gravado (idempotência)', () => {
    const jaGravada: BackfillCandidateRow = { ...baseRow, sourceFingerprint: 'ja-existe-hash' }
    const update = computeTranslationFingerprintBackfill(jaGravada, source)
    expect(update.sourceFingerprint).toBeUndefined()
  })

  it('NÃO recalcula mt_fingerprint se já gravado (idempotência)', () => {
    const jaGravada: BackfillCandidateRow = { ...baseRow, mtFingerprint: 'ja-existe-hash' }
    const update = computeTranslationFingerprintBackfill(jaGravada, source)
    expect(update.mtFingerprint).toBeUndefined()
  })

  it('quando a linha não tem ingredientes jsonb (NULL), o mt_fingerprint usa ingredientes: null', () => {
    const semIngredientes: BackfillCandidateRow = { ...baseRow, ingredientes: null }
    const update = computeTranslationFingerprintBackfill(semIngredientes, source)
    expect(update.mtFingerprint).toBe(
      fingerprintMt({
        titulo: baseRow.titulo,
        descricao: baseRow.descricao,
        passos: baseRow.passos,
        notas: baseRow.notas,
        ingredientes: null,
      }),
    )
  })

  it('quando não há fingerprints a preencher, devolve objeto vazio', () => {
    const tudoPreenchida: BackfillCandidateRow = {
      ...baseRow,
      sourceFingerprint: 'x',
      mtFingerprint: 'y',
    }
    const update = computeTranslationFingerprintBackfill(tudoPreenchida, source)
    expect(update).toEqual({})
  })
})
