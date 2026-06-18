/**
 * Diff DERIVADO congelado — módulo PURO (issue #17, §FROZEN DIFF SHAPE).
 *
 * Espelha o padrão `decide*` dos outros motores do domínio (`recipe-visibility.ts`,
 * `recipe-restrictions.ts`): decisão PURA, total/determinística, ZERO DB/I/O, sem throw,
 * sem efeito. `decideDerivedDiff({base, edits})` compara a Receita-base com as edições do
 * leitor e devolve a forma APRESENTACIONAL versionada que a rota de derivação (`derive.ts`)
 * CONGELA em `recipe.derived_diff` no instante do fork (história 289: a base pode ser
 * apagada depois, anulando `parent_recipe_id` — um diff recomputado na leitura sumiria;
 * por isso ele é calculado UMA vez e ARMAZENADO, NUNCA recomputado contra o pai na leitura).
 *
 * Estritamente ADITIVO/versionado (`v: 1`): novas chaves entram sem quebrar leitores antigos.
 * As sub-chaves saem SEMPRE presentes em `ingredientes`/`restricoes` (arrays podem ser vazios
 * — o leitor #61 itera sem checar presença); em `campos` cada campo é OMITIDO quando inalterado
 * (`titulo?`/`descricao?`/`passos?` — "ausente ≠ vazio", como `RecipeFacets.restricoes`).
 *
 * Byte-estável: a ordem de saída segue a ordem dos arrays de entrada (que a `derive.ts` projeta
 * por `ordem`), sem reordenar — duas chamadas com a mesma entrada produzem o MESMO JSON.
 *
 * `campos.passos` compara as listas como um todo (mudou ⇔ as listas diferem) e carrega as
 * listas inteiras em `de`/`para` — granularidade por-passo fica fora (apresentacional).
 */

import type { Restricao } from '@/domain/vocabulary'

export const DERIVED_DIFF_VERSION = 1 as const

/**
 * Item de ingrediente como o diff o consome: `nome` é o RÓTULO de comparação (o `rawText`
 * do snapshot — texto livre monolíngue) e `quantidade` é `numeric(10,3)` ⇒ string|null,
 * NUNCA number (mesma trava de `recipe_ingredient.quantidade`). Itens são casados por `nome`
 * (igualdade exata): a base e as edições usam o mesmo rótulo de superfície para o mesmo item.
 */
export type DiffIngrediente = {
  nome: string
  quantidade: string | null
}

/** Lado (base ou edits) que o diff compara. Campos textuais + listas estruturadas. */
export type DiffLado = {
  titulo: string
  descricao: string | null
  passos: string[] | null
  ingredientes: ReadonlyArray<DiffIngrediente>
  restricoes: ReadonlyArray<Restricao>
}

/** Mudança de um campo textual escalar: o valor da base (`de`) e o editado (`para`). */
export type CampoAlterado = {
  de: string | null
  para: string | null
}

/** Mudança de campo `passos`: listas inteiras (de/para), não diff por-passo. */
export type PassosAlterado = {
  de: string[] | null
  para: string[] | null
}

/** Mudança de quantidade de um ingrediente que existe nos DOIS lados. */
export type QuantidadeAlterada = {
  nome: string
  de: string | null
  para: string | null
}

/** Forma CONGELADA do diff (versionada). Persistida em `recipe.derived_diff` como JSONB. */
export type DerivedDiff = {
  v: typeof DERIVED_DIFF_VERSION
  ingredientes: {
    adicionados: string[]
    removidos: string[]
    quantidadeAlterada: QuantidadeAlterada[]
  }
  restricoes: {
    adicionadas: Restricao[]
    removidas: Restricao[]
  }
  campos: {
    titulo?: CampoAlterado
    descricao?: CampoAlterado
    passos?: PassosAlterado
  }
}

/** Igualdade de listas de passos (ordem importa). `null` e `[]` são distintos só por valor. */
function passosIguais(a: string[] | null, b: string[] | null): boolean {
  if (a == null && b == null) return true
  if (a == null || b == null) return false
  if (a.length !== b.length) return false
  return a.every((p, i) => p === b[i])
}

/**
 * Compara a Receita-base com as edições do leitor e devolve o diff APRESENTACIONAL
 * congelado. PURO/total: nunca lança; entradas idênticas ⇒ saída byte-idêntica.
 *
 * Ingredientes: casados por `nome` (igualdade exata). Presente só nos edits ⇒ adicionado;
 * só na base ⇒ removido; nos dois com `quantidade` diferente ⇒ quantidadeAlterada (de/para).
 * A ordem de saída segue a ordem das listas de entrada (sem reordenar).
 *
 * Campos textuais: incluídos em `campos` SÓ quando mudam (titulo string-vs-string; descricao
 * string|null; passos listas inteiras). Inalterado ⇒ chave AUSENTE.
 */
export function decideDerivedDiff(input: { base: DiffLado; edits: DiffLado }): DerivedDiff {
  const { base, edits } = input

  // ── Ingredientes (casados por nome de superfície) ──────────────────────────
  const baseByNome = new Map(base.ingredientes.map((i) => [i.nome, i]))
  const editsByNome = new Map(edits.ingredientes.map((i) => [i.nome, i]))

  const adicionados: string[] = []
  const quantidadeAlterada: QuantidadeAlterada[] = []
  for (const item of edits.ingredientes) {
    const antes = baseByNome.get(item.nome)
    if (!antes) {
      adicionados.push(item.nome)
      continue
    }
    if (antes.quantidade !== item.quantidade) {
      quantidadeAlterada.push({ nome: item.nome, de: antes.quantidade, para: item.quantidade })
    }
  }

  const removidos: string[] = []
  for (const item of base.ingredientes) {
    if (!editsByNome.has(item.nome)) removidos.push(item.nome)
  }

  // ── Restrições (conjuntos; ordem segue o array de entrada) ──────────────────
  const baseRestr = new Set<Restricao>(base.restricoes)
  const editsRestr = new Set<Restricao>(edits.restricoes)
  const adicionadas = edits.restricoes.filter((r) => !baseRestr.has(r))
  const removidas = base.restricoes.filter((r) => !editsRestr.has(r))

  // ── Campos textuais (omitidos quando inalterados — ausente ≠ vazio) ─────────
  const campos: DerivedDiff['campos'] = {}
  if (base.titulo !== edits.titulo) campos.titulo = { de: base.titulo, para: edits.titulo }
  if (base.descricao !== edits.descricao) {
    campos.descricao = { de: base.descricao, para: edits.descricao }
  }
  if (!passosIguais(base.passos, edits.passos)) {
    campos.passos = { de: base.passos, para: edits.passos }
  }

  return {
    v: DERIVED_DIFF_VERSION,
    ingredientes: { adicionados, removidos, quantidadeAlterada },
    restricoes: { adicionadas, removidas },
    campos,
  }
}
