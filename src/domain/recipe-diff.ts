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

// ── Igualdade SEMÂNTICA (o que o leitor perceberia como "igual") ─────────────
// O form de edição devolve as coisas noutra FORMA que o banco guarda: quantidade "3.000"
// (`numeric(10,3)`) volta "3"; título/rawText voltam aparados; passos voltam um por linha, sem
// linhas vazias; descrição vazia vira null. Comparar BYTE a BYTE fazia uma cópia sem mudança
// nenhuma listar "sal: 3 → 3". Estes helpers comparam como o leitor lê.

/** Texto livre: aparado; vazio ⇔ null. */
function normTexto(v: string | null | undefined): string | null {
  if (v == null) return null
  const t = v.trim()
  return t === '' ? null : t
}

/** Quantidade: numérica ⇒ compara o NÚMERO ("3.000" = "3" = "3.0"); senão o texto aparado. */
export function quantidadesIguais(a: string | null, b: string | null): boolean {
  const x = normTexto(a)
  const y = normTexto(b)
  if (x === y) return true
  if (x == null || y == null) return false
  const nx = Number(x)
  const ny = Number(y)
  return Number.isFinite(nx) && Number.isFinite(ny) && nx === ny
}

/** Passos como o form os devolve: um por linha, aparados, sem linhas vazias; lista vazia ⇔ null. */
function normPassos(passos: string[] | null | undefined): string[] | null {
  if (passos == null) return null
  const out = passos
    .flatMap((p) => p.split('\n'))
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  return out.length > 0 ? out : null
}

/** Igualdade de listas de passos (ordem importa), depois de normalizar a forma. */
function passosIguais(a: string[] | null, b: string[] | null): boolean {
  const x = normPassos(a)
  const y = normPassos(b)
  if (x == null && y == null) return true
  if (x == null || y == null) return false
  if (x.length !== y.length) return false
  return x.every((p, i) => p === y[i])
}

/** Chave de casamento do ingrediente: o rótulo aparado (o form apara o `rawText`). */
function chaveNome(nome: string): string {
  return nome.trim()
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
  const baseByNome = new Map(base.ingredientes.map((i) => [chaveNome(i.nome), i]))
  const editsByNome = new Map(edits.ingredientes.map((i) => [chaveNome(i.nome), i]))

  const adicionados: string[] = []
  const quantidadeAlterada: QuantidadeAlterada[] = []
  for (const item of edits.ingredientes) {
    const antes = baseByNome.get(chaveNome(item.nome))
    if (!antes) {
      adicionados.push(item.nome)
      continue
    }
    if (!quantidadesIguais(antes.quantidade, item.quantidade)) {
      quantidadeAlterada.push({ nome: item.nome, de: antes.quantidade, para: item.quantidade })
    }
  }

  const removidos: string[] = []
  for (const item of base.ingredientes) {
    if (!editsByNome.has(chaveNome(item.nome))) removidos.push(item.nome)
  }

  // ── Restrições (conjuntos; ordem segue o array de entrada) ──────────────────
  const baseRestr = new Set<Restricao>(base.restricoes)
  const editsRestr = new Set<Restricao>(edits.restricoes)
  const adicionadas = edits.restricoes.filter((r) => !baseRestr.has(r))
  const removidas = base.restricoes.filter((r) => !editsRestr.has(r))

  // ── Campos textuais (omitidos quando inalterados — ausente ≠ vazio) ─────────
  const campos: DerivedDiff['campos'] = {}
  if (normTexto(base.titulo) !== normTexto(edits.titulo)) {
    campos.titulo = { de: base.titulo, para: edits.titulo }
  }
  if (normTexto(base.descricao) !== normTexto(edits.descricao)) {
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

/**
 * Poda na LEITURA as "mudanças" que não mudam nada (ADR-0045 dec.2). Diffs congelados antes da
 * igualdade semântica acima guardaram ruído de forma ("sal: 3.000 → 3", título com espaço no
 * fim, passos com linha em branco). NÃO recomputa contra a base (história 289 segue valendo:
 * só o que está ARMAZENADO é lido); apenas descarta entradas cujo de/para são iguais pelo
 * mesmo critério de `decideDerivedDiff`. Um adicionado e um removido com o MESMO rótulo
 * aparado são o mesmo item (espaço sobrando no rawText) e saem os dois. Idempotente.
 */
export function pruneNoopChanges(diff: DerivedDiff): DerivedDiff {
  const adicionadosChave = new Set(diff.ingredientes.adicionados.map(chaveNome))
  const removidosChave = new Set(diff.ingredientes.removidos.map(chaveNome))
  const campos: DerivedDiff['campos'] = {}
  const { titulo, descricao, passos } = diff.campos
  if (titulo && normTexto(titulo.de) !== normTexto(titulo.para)) campos.titulo = titulo
  if (descricao && normTexto(descricao.de) !== normTexto(descricao.para)) campos.descricao = descricao
  if (passos && !passosIguais(passos.de, passos.para)) campos.passos = passos
  return {
    ...diff,
    ingredientes: {
      adicionados: diff.ingredientes.adicionados.filter((n) => !removidosChave.has(chaveNome(n))),
      removidos: diff.ingredientes.removidos.filter((n) => !adicionadosChave.has(chaveNome(n))),
      quantidadeAlterada: diff.ingredientes.quantidadeAlterada.filter(
        (q) => !quantidadesIguais(q.de, q.para),
      ),
    },
    campos,
  }
}

/** O diff não tem nenhuma mudança (cópia fiel). A UI esconde a seção "O que mudou". */
export function isEmptyDiff(diff: DerivedDiff): boolean {
  return (
    diff.ingredientes.adicionados.length === 0 &&
    diff.ingredientes.removidos.length === 0 &&
    diff.ingredientes.quantidadeAlterada.length === 0 &&
    diff.restricoes.adicionadas.length === 0 &&
    diff.restricoes.removidas.length === 0 &&
    diff.campos.titulo === undefined &&
    diff.campos.descricao === undefined &&
    diff.campos.passos === undefined
  )
}

/**
 * Passos alterados como o leitor quer ver (ADR-0045 dec.3): SÓ os passos que entraram e os que
 * saíram, não as duas listas inteiras. Compara por texto normalizado (multiconjunto: um passo
 * repetido conta duas vezes). `reordenados` quando nada entrou/saiu mas a ordem mudou.
 */
export function stepChanges(de: string[] | null, para: string[] | null): {
  adicionados: string[]
  removidos: string[]
  reordenados: boolean
} {
  const a = normPassos(de) ?? []
  const b = normPassos(para) ?? []
  const restantes = new Map<string, number>()
  for (const p of a) restantes.set(p, (restantes.get(p) ?? 0) + 1)
  const adicionados: string[] = []
  for (const p of b) {
    const n = restantes.get(p) ?? 0
    if (n > 0) restantes.set(p, n - 1)
    else adicionados.push(p)
  }
  const removidos: string[] = []
  const consumidos = new Map<string, number>()
  for (const p of b) consumidos.set(p, (consumidos.get(p) ?? 0) + 1)
  for (const p of a) {
    const n = consumidos.get(p) ?? 0
    if (n > 0) consumidos.set(p, n - 1)
    else removidos.push(p)
  }
  const reordenados =
    adicionados.length === 0 && removidos.length === 0 && a.some((p, i) => p !== b[i])
  return { adicionados, removidos, reordenados }
}
