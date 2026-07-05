/**
 * Edição do NOME de ingrediente traduzido pelo Curador — módulo PURO (issue #498, ADR-0031
 * companheiro (iii)). Mescla edições `{ordem, nome}` no `ingredientes jsonb` existente de
 * `recipe_translation` (ADR-0030 dec.4: `{ordem, nome, nomeOrigem}[]`), sem tocar a MEDIDA
 * (quantidade/unidade, fonte única em `recipe_ingredient`) nem o `raw_text`.
 *
 * DECISÃO (documentada aqui, load-bearing): ao editar o nome de um `ordem`, o `nomeOrigem`
 * gravado é o `raw_text` ATUAL daquele item (não o `nomeOrigem` antigo da entrada). A
 * resolução auto-validante (`resolveIngredientNames`/`resolveRecipeView`, ADR-0030 dec.4/5)
 * só exibe `nome` quando `nomeOrigem === raw_text atual` — gravar o `raw_text` atual garante
 * que o nome RECÉM-EDITADO seja exibido IMEDIATAMENTE, mesmo que a entrada anterior já
 * estivesse divergente (rename prévio sem re-tradução). Isso também é o que torna a edição
 * segura sob a máquina de fingerprint da fatia A (ADR-0031 dec.2): o conteúdo da linha muda,
 * o `mt_fingerprint` diverge, e a linha vira não-intocada (nunca mais auto-sobrescrita).
 *
 * Entradas de `ordem` NÃO presentes nas edições são preservadas intocadas; um `ordem` editado
 * que ainda não tinha entrada no jsonb ganha uma nova. `existing === null` (receita sem nenhum
 * ingrediente nomeado) parte de array vazio.
 */

export type IngredienteTraduzido = { ordem: number; nome: string; nomeOrigem: string }

export type IngredientNameEdit = {
  ordem: number
  /** Nome editado, já trim() e não-vazio (validado na borda). */
  nome: string
  /** `raw_text` ATUAL do item `ordem` em `recipe_ingredient` (carregado pelo serviço). */
  rawTextAtual: string
}

export function mergeIngredientNameEdits(
  existing: ReadonlyArray<IngredienteTraduzido> | null,
  edits: ReadonlyArray<IngredientNameEdit>,
): IngredienteTraduzido[] {
  const byOrdem = new Map<number, IngredienteTraduzido>()
  for (const item of existing ?? []) byOrdem.set(item.ordem, item)
  for (const edit of edits) {
    byOrdem.set(edit.ordem, { ordem: edit.ordem, nome: edit.nome, nomeOrigem: edit.rawTextAtual })
  }
  return [...byOrdem.values()].sort((a, b) => a.ordem - b.ordem)
}
