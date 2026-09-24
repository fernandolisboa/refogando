import { sourceFingerprintOf, mtFingerprintOfRow } from '@/domain/translation-fingerprint'
import type { TranslationProvenance } from '@/domain/recipe'

/**
 * Regra PURA de seleção/construção do backfill de fingerprints (issue #501, ADR-0031 dec.7 —
 * migração AGRESSIVA). Reusa as MESMAS `fingerprintSource`/`fingerprintMt` da fatia A (#496) — só
 * decide QUANDO gravar cada uma e a partir de QUAIS campos, espelhando byte-a-byte a construção
 * de `ensureTranslation` (`src/server/recipe/translation.ts`) para que o hash gravado aqui seja
 * IDÊNTICO ao que o runtime recomputaria na varredura de staleness.
 *
 * Extraída do script (`scripts/backfill-translation-fingerprints.ts`) para ser testável sem tocar
 * o banco — o script fica um wrapper fino de I/O (carrega linhas, chama esta função, faz o UPDATE
 * guardado por `WHERE ... IS NULL`).
 */

/** A linha DERIVADA (locale ≠ original_locale) sendo considerada para o backfill. */
export type BackfillCandidateRow = {
  provenance: TranslationProvenance
  /** `NULL` = ainda não carimbado (elegível a preencher). */
  sourceFingerprint: string | null
  /** `NULL` = ainda não carimbado (elegível a preencher SÓ se `automatica_nao_revisada`). */
  mtFingerprint: string | null
  // Conteúdo ATUAL da PRÓPRIA linha (o que a MT produziu) — insumo do `mt_fingerprint`.
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  /** Coluna `ingredientes` jsonb da própria linha ({ordem, nome, nomeOrigem}[] | null). O
   * `nomeOrigem` é escrituração, fora do hash — só {ordem, nome} entra em `fingerprintMt`. */
  ingredientes: ReadonlyArray<{ ordem: number; nome: string; nomeOrigem?: string }> | null
}

/** Fonte ATUAL (locale original + `raw_text` dos ingredientes) — insumo do `source_fingerprint`. */
export type BackfillSourceFields = {
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  /** `raw_text` por `ordem`, já filtrado (não-vazio) e ordenado como o loader (`ordem`, `id`). */
  ingredientes: ReadonlyArray<{ ordem: number; nome: string }>
}

export type BackfillFingerprintUpdate = {
  sourceFingerprint?: string
  mtFingerprint?: string
}

/**
 * Decide o que gravar para UMA linha derivada:
 *  - `sourceFingerprint`: presente quando `row.sourceFingerprint` ainda é `NULL` — marco seguro,
 *    em TODA linha derivada, independente de proveniência (decisão 7 — "todas as linhas").
 *  - `mtFingerprint`: presente SÓ quando `row.provenance === 'automatica_nao_revisada'` E
 *    `row.mtFingerprint` ainda é `NULL` — as confiáveis (`automatica_revisada`/
 *    `escrita_por_pessoa`) ficam de propósito com `mt_fingerprint` NULL (trabalho humano,
 *    nunca auto-elegível).
 *
 * Campos ausentes no retorno ⇒ "não toca" (nem recalcula, nem grava) — quem chama só faz UPDATE
 * das chaves presentes (e mesmo assim com `WHERE ... IS NULL` reafirmado, por segurança dupla).
 */
export function computeTranslationFingerprintBackfill(
  row: BackfillCandidateRow,
  source: BackfillSourceFields,
): BackfillFingerprintUpdate {
  const update: BackfillFingerprintUpdate = {}

  if (row.sourceFingerprint == null) {
    // Helper compartilhado com `ensureTranslation` (via #499) = fonte ÚNICA de construção do hash:
    // campos do locale ORIGINAL + `raw_text` dos ingredientes (array, nunca `null`).
    update.sourceFingerprint = sourceFingerprintOf(
      { titulo: source.titulo, descricao: source.descricao, passos: source.passos, notas: source.notas },
      source.ingredientes,
    )
  }

  if (row.provenance === 'automatica_nao_revisada' && row.mtFingerprint == null) {
    // Mesmo helper compartilhado: campos da PRÓPRIA linha + o mapa `ordem→nome` do jsonb `ingredientes`
    // (o helper descarta `nomeOrigem` e colapsa lista vazia→null, igual ao write-path).
    update.mtFingerprint = mtFingerprintOfRow({
      titulo: row.titulo,
      descricao: row.descricao,
      passos: row.passos,
      notas: row.notas,
      ingredientes: row.ingredientes,
    })
  }

  return update
}
