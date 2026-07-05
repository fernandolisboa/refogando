import { createHash } from 'node:crypto'

/**
 * Fingerprints de conteúdo da tradução (issue #496, ADR-0031). Duas funções PURAS e
 * DETERMINÍSTICAS que reduzem o conteúdo a um `sha256` hex, para que a máquina de
 * re-tradução derive por COMPARAÇÃO (modelo pull) — sem flags empurradas:
 *
 *  - `fingerprintSource` = hash da FONTE de onde a tradução saiu (campos traduzíveis do
 *    locale original + os nomes-fonte `raw_text` dos ingredientes por `ordem`). "Defasada" =
 *    `fingerprintSource(fonte atual) ≠ source_fingerprint` gravado (o original mudou).
 *  - `fingerprintMt` = hash do que a MT PRODUZIU (campos traduzíveis + o mapa `ordem→nome`
 *    do `ingredientes jsonb`). "Intocada" = `fingerprintMt(conteúdo atual) == mt_fingerprint`
 *    gravado (ninguém editou desde a última MT). É a TRAVA de segurança contra sobrescrever
 *    trabalho humano — `mt_fingerprint` NULL ⇒ NUNCA intocada.
 *
 * A MESMA função gera o fingerprint na ESCRITA (`ensureTranslation`, worker, backfill) e
 * recomputa o hash-de-comparação na LEITURA (worker/fila do Curador); se as duas divergirem,
 * a segurança inteira quebra — por isso é fonte única, testável byte-a-byte (espelha a
 * disciplina de `assertFaithfulTranslation`/`decideStale`).
 *
 * Server-only por natureza (`node:crypto`; importada só por código de servidor). A MEDIDA
 * (quantidade/unidade) NUNCA entra em nenhum fingerprint (Direção B, invariante entre locales).
 */

// Separadores RESERVADOS (símbolos de controle Unicode, improváveis no conteúdo culinário) para
// que a serialização seja INJETIVA — juntar campos/itens nunca colide com o conteúdo em si.
const FIELD_SEP = '␞' // ␞
const ITEM_SEP = '␟' // ␟
// Marcador EXPLÍCITO de ausência: distingue `null` (campo inexistente) de `''` (string vazia).
const NULL_MARK = '␀∅'

function field(v: string | null | undefined): string {
  return v == null ? NULL_MARK : v
}

function arrayField(items: readonly (string | null)[] | null | undefined): string {
  if (items == null) return NULL_MARK
  return items.map(field).join(ITEM_SEP)
}

/**
 * Ingredientes por `ordem` — ordenados por `ordem` (estável independente da ordem do array de
 * entrada; o `ordem` é a identidade). `null` (sem ingrediente nomeado) ⇒ marcador de ausência,
 * distinto de `[]` (lista vazia).
 */
function ingredientsField(
  items: ReadonlyArray<{ ordem: number; nome: string }> | null | undefined,
): string {
  if (items == null) return NULL_MARK
  return [...items]
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => `${i.ordem}=${field(i.nome)}`)
    .join(ITEM_SEP)
}

function digest(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join(FIELD_SEP), 'utf8').digest('hex')
}

export type SourceFingerprintInput = {
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  /** Nomes-fonte (`raw_text`) dos ingredientes por `ordem`. `null` = sem ingrediente nomeado. */
  ingredientes: ReadonlyArray<{ ordem: number; nome: string }> | null
}

export function fingerprintSource(input: SourceFingerprintInput): string {
  return digest([
    'v1',
    'src',
    field(input.titulo),
    field(input.descricao),
    arrayField(input.passos),
    field(input.notas),
    ingredientsField(input.ingredientes),
  ])
}

export type MtFingerprintInput = {
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  /** Nomes TRADUZIDOS por `ordem` (mapa do `ingredientes jsonb`). `null` = sem nome traduzido. */
  ingredientes: ReadonlyArray<{ ordem: number; nome: string }> | null
}

export function fingerprintMt(input: MtFingerprintInput): string {
  return digest([
    'v1',
    'mt',
    field(input.titulo),
    field(input.descricao),
    arrayField(input.passos),
    field(input.notas),
    ingredientsField(input.ingredientes),
  ])
}
