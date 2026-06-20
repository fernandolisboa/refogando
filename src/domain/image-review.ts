/**
 * Classificador PURO da revisão de imagem ao versionar (issue #131, ADR-0016) — decide se a
 * versão NOVA de uma Receita deve SUGERIR ao dono revisar a foto ("gerar/subir nova imagem?").
 *
 * Espelha o padrão `decide*` dos outros motores (`recipe-diff.ts`, `generation.ts`): puro, total,
 * determinístico, ZERO DB/I/O, sem throw. A regra (ADR-0016): a mudança é VISUALMENTE relevante
 * quando **ingredientes (o conjunto), título OU cozinha** mudaram → grande → sugere. Mudança só
 * COSMÉTICA (porções, dificuldade, notas, descrição, restrições, quantidade) é silenciosa.
 *
 * A imagem é carregada-pra-frente (carry-forward) ao editar/derivar/regenerar — então a sugestão
 * só faz sentido quando a versão nova DE FATO herdou uma imagem (`hasImage`); sem imagem não há o
 * que revisar (o dono simplesmente adiciona uma pelo controle normal).
 */

import type { DerivedDiff } from '@/domain/recipe-diff'

/** Campos cuja mudança é VISUALMENTE relevante (a foto pode não bater mais) — #131/ADR-0016. */
export const VISUAL_FIELDS = ['titulo', 'ingredientes', 'cozinha'] as const
export type VisualField = (typeof VISUAL_FIELDS)[number]

const VISUAL_SET: ReadonlySet<string> = new Set(VISUAL_FIELDS)

/**
 * Decisão central: sugerir revisar a imagem? SÓ quando a versão herdou uma imagem (`hasImage`) E
 * ≥1 campo VISUAL mudou. `changed` é a lista de campos mudados (qualquer vocabulário; só os de
 * `VISUAL_FIELDS` disparam — nomes fora dela, como `porcoes`/`restricoes`, são ignorados).
 */
export function shouldSuggestNewImage(input: {
  hasImage: boolean
  changed: ReadonlyArray<string>
}): boolean {
  if (!input.hasImage) return false
  return input.changed.some((f) => VISUAL_SET.has(f))
}

/**
 * Extrai os campos VISUAIS mudados de um `DerivedDiff` (caminho derivar/#17, que CONGELA o diff).
 * Título: presente em `campos.titulo`. Ingredientes: o CONJUNTO mudou (adicionados/removidos) —
 * uma mudança só-de-quantidade NÃO é visual (o prato parece o mesmo). Cozinha não vive no
 * DerivedDiff (derivar herda a cozinha da base, nunca a muda) ⇒ nunca surge por aqui.
 */
export function visualChangesFromDiff(diff: DerivedDiff): VisualField[] {
  const changed: VisualField[] = []
  if (diff.campos.titulo) changed.push('titulo')
  if (diff.ingredientes.adicionados.length > 0 || diff.ingredientes.removidos.length > 0) {
    changed.push('ingredientes')
  }
  return changed
}

/** Snapshot mínimo para a comparação do regenerar: título + cozinha + rótulos de ingrediente. */
export type ImageReviewSnapshot = {
  titulo: string
  cozinha: string | null
  ingredientes: ReadonlyArray<string>
}

/**
 * Compara dois snapshots (regenerar/#20, que NÃO carrega diff) e devolve os campos VISUAIS que
 * mudaram: título (igualdade), cozinha (igualdade), e o CONJUNTO de ingredientes (igualdade de
 * conjunto por rótulo — ordem e duplicatas irrelevantes). PURO/total.
 */
export function visualChangesBetween(
  before: ImageReviewSnapshot,
  after: ImageReviewSnapshot,
): VisualField[] {
  const changed: VisualField[] = []
  if (before.titulo !== after.titulo) changed.push('titulo')
  if (before.cozinha !== after.cozinha) changed.push('cozinha')
  if (!sameSet(before.ingredientes, after.ingredientes)) changed.push('ingredientes')
  return changed
}

/**
 * O CONJUNTO de rótulos de ingrediente mudou? (ordem, duplicatas e QUANTIDADE irrelevantes — só o
 * conjunto de rawText conta). Usado pela edição in-place (#21) pra decidir se a mudança de
 * ingredientes é VISUAL — casando a semântica de derivar (`visualChangesFromDiff`, conjunto via
 * adicionados/removidos) e regenerar (`visualChangesBetween`). Mudança só-de-quantidade ⇒ false.
 */
export function ingredientSetChanged(
  before: ReadonlyArray<string>,
  after: ReadonlyArray<string>,
): boolean {
  return !sameSet(before, after)
}

/** Igualdade de CONJUNTO (ignora ordem e duplicatas). */
function sameSet(a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean {
  const sa = new Set(a)
  const sb = new Set(b)
  if (sa.size !== sb.size) return false
  for (const x of sa) if (!sb.has(x)) return false
  return true
}
