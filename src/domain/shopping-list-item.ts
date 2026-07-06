import { normalizeText } from '@/domain/recipe-restrictions'
import { scaleQuantidade } from '@/domain/ingredient-line'
import { isUnidade, type Unidade } from '@/domain/vocabulary'

/**
 * Kernel PURO da agregação/merge de Itens da Lista de compras — o TRACER (fatia A2, issue #526,
 * ADR-0032 dec.2/4), a ESCALA por porções (fatia B, #527) e a EDIÇÃO À MÃO (fatia C, #528, dec.5:
 * validação do item avulso) — sem DB, sem I/O. Companheiro de `@/domain/shopping-list`
 * (container, #525): lá vive a regra do NOME/cap da Lista; aqui vive a regra de CONSOLIDAR os
 * Itens de uma Receita em linhas de compra + a validação do item AVULSO. O efeito (ler a Receita,
 * resolver nome por-locale, fazer o upsert) mora no servidor (`@/server/shopping-list/shopping-list`).
 */

/**
 * Item de ingrediente já RESOLVIDO (nome no locale do usuário NO MOMENTO do add — #426,
 * `resolveIngredientName`), pronto para consolidar. `quantidade` é numeric(10,3)-como-STRING
 * (nunca number — mesma tese de `recipe_ingredient`/`ingredient-line.ts`).
 */
export type IngredientToAdd = {
  ingredientId: string | null
  nome: string
  quantidade: string | null
  unidade: Unidade | null
}

/**
 * Teto de Receitas por lote no multi-adicionar (fatia E, issue #530, ADR-0032 dec.7) — anti-abuso
 * barato: uma seleção de UI realista (checkboxes numa grade) nunca chega a centenas de Receitas;
 * blinda contra um payload forjado com milhares de ids (cada um vira um upsert sequencial).
 */
export const MAX_RECIPES_PER_BATCH_ADD = 50

/**
 * Linha PRONTA para o upsert em `shopping_list_item` — já consolidada por (chave, unidade) DENTRO
 * do lote de UMA Receita. Necessário porque um único INSERT multi-valores com `ON CONFLICT DO
 * UPDATE` não pode mirar o MESMO alvo de conflito duas vezes na mesma sentença (o Postgres rejeita
 * com "ON CONFLICT DO UPDATE command cannot affect row a second time") — então a mesma Receita
 * citando "sal" duas vezes na mesma unidade vira UMA linha ANTES de chegar no banco.
 */
export type ShoppingListLineDraft = {
  matchKey: string
  unidade: Unidade | null
  nome: string
  quantidade: string | null
  ingredientId: string | null
}

/**
 * Chave de AGREGAÇÃO (ADR-0032 dec.2): `ingredientId` (Ingrediente canônico) quando presente —
 * mas a FK `recipe_ingredient.ingredient_id` é QUASE SEMPRE nula (resolução best-effort, CONTEXT.md
 * "Item de receita"), então o fallback carrega a maior parte da mesclagem na prática — senão
 * `normalize(nome)` via `normalizeText` (minúsculo, sem acento, trim). `normalizeText` é a MESMA
 * normalização já usada em tags/handle/dedup de Briefing (#7/#19/#426, `recipe-restrictions.ts`) —
 * REUSADA aqui, nunca reimplementada (fonte única do domínio, ADR-0032 Consequências).
 */
export function computeMatchKey(input: { ingredientId: string | null; nome: string }): string {
  if (input.ingredientId != null) return input.ingredientId
  return normalizeText(input.nome)
}

/**
 * Soma duas quantidades numeric(10,3)-como-string. O caller só chama isto dentro do MESMO par
 * chave+unidade (dec.2) — NUNCA converte unidade. `null` é "SEM quantidade" (a_gosto/q.b.), não
 * zero:
 *  - as duas ausentes ⇒ ausente (nada a somar, a linha permanece sem número).
 *  - só uma ausente ⇒ preserva a PRESENTE (a ausência da outra não apaga o que já se sabia — NUNCA
 *    "some nulls" pra virar um valor menor/zerado).
 *  - as duas presentes ⇒ soma, arredondada a 3 casas (espelha a coluna `numeric(10,3)`, mesma tese
 *    de `scaleQuantidade` em `ingredient-line.ts` — evita ruído de ponto-flutuante).
 */
export function combineQuantidade(a: string | null, b: string | null): string | null {
  if (a == null) return b
  if (b == null) return a
  const na = Number(a.replace(',', '.'))
  const nb = Number(b.replace(',', '.'))
  if (!Number.isFinite(na)) return b // defensivo: lado A não-numérico, prefere o lado B
  if (!Number.isFinite(nb)) return a // defensivo: lado B não-numérico, prefere o lado A
  return String(Math.round((na + nb) * 1000) / 1000)
}

/**
 * Resolução do fator de escala por PORÇÕES-ALVO (fatia B, issue #527, ADR-0032 dec.3): `ratio =
 * alvo ÷ receita.porcoes`. Puro cálculo de fator — a MULTIPLICAÇÃO em si é `scaleQuantidade`
 * (#452, `ingredient-line.ts`), REUSADA aqui, nunca reimplementada (a mesma tese do
 * `computeMatchKey` reusando `normalizeText`).
 *
 *  - sem `porcoesAlvo` pedido (fluxo antigo da A2 / o multi-add da fatia E): fator 1 — no-op, sem
 *    aviso.
 *  - `porcoesAlvo` pedido mas a Receita NÃO tem `porcoes` declarada (`null`/`0`, ADR-0032 "não
 *    inventa porção"): fator 1 (entra na BASE) + aviso `'sem_porcoes'` — o caller decide como
 *    exibir/propagar o aviso (a rota devolve no corpo da resposta).
 *  - os dois presentes: fator = alvo ÷ porcoes, aritmética pura, sem aviso.
 */
export type ShoppingListScale = { factor: number; warning: 'sem_porcoes' | null }

export function resolveShoppingListScale(input: {
  porcoesAlvo: number | null
  receitaPorcoes: number | null
}): ShoppingListScale {
  const { porcoesAlvo, receitaPorcoes } = input
  if (porcoesAlvo == null) return { factor: 1, warning: null }
  if (receitaPorcoes == null || receitaPorcoes <= 0) return { factor: 1, warning: 'sem_porcoes' }
  return { factor: porcoesAlvo / receitaPorcoes, warning: null }
}

/**
 * Escala a `quantidade` de cada Item pelo `factor` — via `scaleQuantidade` (#452), ANTES da
 * consolidação (a quantidade JÁ ESCALADA é o que entra na agregação/snapshot, ADR-0032 dec.3).
 * `unidade`/`nome`/`ingredientId` seguem intactos (a escala nunca muda a NATUREZA da medida, mesma
 * tese de `scaleIngredient` em `ingredient-line.ts`). Fator 1 (caso comum: sem porções-alvo pedido)
 * devolve os itens tais quais — evita passar `quantidade` numérica por round-trip de
 * string→number→string sem necessidade (ruído de ponto-flutuante zero quando não há escala).
 */
export function scaleIngredientsToAdd(
  items: ReadonlyArray<IngredientToAdd>,
  factor: number,
): IngredientToAdd[] {
  if (factor === 1) return items as IngredientToAdd[]
  return items.map((it) => ({ ...it, quantidade: scaleQuantidade(it.quantidade, factor) }))
}

/**
 * Consolida os Itens de UMA Receita em linhas de Lista de compras — a regra de MERGE pura do
 * ADR-0032 dec.2/4: agrupa por (chave, unidade) — a MESMA chave com unidades DIFERENTES vira
 * linhas SEPARADAS (nunca converte unidade); soma `quantidade` só DENTRO do mesmo grupo
 * (`combineQuantidade`). A PRIMEIRA ocorrência decide `nome`/`ingredientId` do grupo (mesmo padrão
 * de `dedupeBriefing` — primeira ocorrência vence); na prática é irrelevante qual "ganha", porque o
 * MESMO `matchKey` já implica o MESMO `ingredientId` (quando conhecido) ou o MESMO nome normalizado
 * (quando por nome — ex. "Açúcar"/"acucar" mesclam sob a MESMA chave). Itens sem nome (vazio após
 * trim) são DESCARTADOS — não há o que listar. `unidade` fica `null` quando o Item de origem não
 * tinha (ex. sem medida alguma) — o índice `NULLS NOT DISTINCT` do A1 trata isso como IGUAL a outro
 * `null` da MESMA chave, então aqui a chave de bucket usa um sentinela estável para `null`.
 */
export function consolidateIngredientsToAdd(
  items: ReadonlyArray<IngredientToAdd>,
): ShoppingListLineDraft[] {
  const order: string[] = []
  const buckets = new Map<string, ShoppingListLineDraft>()

  for (const it of items) {
    const nome = it.nome.trim()
    if (nome === '') continue

    const matchKey = computeMatchKey({ ingredientId: it.ingredientId, nome })
    // Chave de bucket = tupla (matchKey, unidade) serializada — JSON.stringify é inequívoco
    // (nunca colide, mesmo que o nome normalizado contenha espaços) E mantém o fonte como TEXTO
    // (sem byte de controle NUL, que faria o git tratar o arquivo como binário).
    const bucketKey = JSON.stringify([matchKey, it.unidade])

    const existing = buckets.get(bucketKey)
    if (existing) {
      existing.quantidade = combineQuantidade(existing.quantidade, it.quantidade)
    } else {
      order.push(bucketKey)
      buckets.set(bucketKey, {
        matchKey,
        unidade: it.unidade,
        nome,
        quantidade: it.quantidade,
        ingredientId: it.ingredientId,
      })
    }
  }

  return order.map((k) => buckets.get(k)!)
}

// ── Edição à mão (fatia C, issue #528, ADR-0032 dec.5) ───────────────────────────

/** Comprimento máximo do NOME de um item avulso, por code point — generoso o bastante pra frases
 * como "azeite extra-virgem prensado a frio", mas barra abuso de texto livre gigante. Espelha o
 * espírito de `SHOPPING_LIST_NAME_MAX` (shopping-list.ts), com teto maior (é o NOME de um
 * ingrediente/produto, não o título curto de uma Lista). */
export const SHOPPING_LIST_ITEM_NOME_MAX = 200

/**
 * Formato de `quantidade` como numeric(10,3)-string, JÁ CANONICALIZADO (ponto decimal — o cliente
 * converte vírgula→ponto por locale via `parseQuantityInput` ANTES do POST/PATCH, mesma tese de
 * `recipe-edit-form.tsx`). Espelha a FORMA do regex já usado em `recipe-gen-schema.ts`/
 * `generation.ts` (`/^-?\d{1,7}(\.\d{1,3})?$/`), mas AQUI a quantidade é a de uma COMPRA — nunca
 * negativa nem zero (não existe "comprar -3kg" ou "comprar 0"; quem quer remover a quantidade usa
 * `null`, quem quer remover a LINHA usa o remove). Essa é uma restrição NOVA e mais estrita que a
 * de geração por IA (que aceita negativo/zero defensivamente) — deliberada para este domínio.
 */
const QUANTIDADE_ITEM_RE = /^\d{1,7}(\.\d{1,3})?$/

/** Valida uma `quantidade` de item de Lista (numeric(10,3)-string canônica, positiva). `null` é
 * sempre válido ("sem quantidade" — a_gosto/q.b./item ad-hoc sem medida, ADR-0032 dec.5). */
export function isValidItemQuantidade(value: string | null): boolean {
  if (value == null) return true
  if (!QUANTIDADE_ITEM_RE.test(value)) return false
  return Number(value) > 0
}

/** Resultado da validação do item avulso: `ok:true` devolve os campos JÁ TRIMADOS/normalizados
 * (o que se grava); `ok:false` traz o motivo — o servidor mapeia cada um a um 400 específico
 * (`nome_invalido`/`quantidade_invalida`/`unidade_invalida`), nunca 500. */
export type AdhocItemValidation =
  | { ok: true; nome: string; quantidade: string | null; unidade: Unidade | null }
  | { ok: false; reason: 'nome_invalido' | 'quantidade_invalida' | 'unidade_invalida' }

/**
 * Valida um item AVULSO digitado à mão (ADR-0032 dec.5): **nome obrigatório**, quantidade/unidade
 * **opcionais** (mesmo enum de unidade dos itens vindos de Receita — ad-hoc pode não ter unidade).
 * Nunca re-embute a medida no nome (contrato do Adendo 2 — quem chama já separa nome de
 * quantidade/unidade; esta função só valida a FORMA de cada campo, não composição de texto).
 */
export function validateAdhocItem(input: {
  nome: string
  quantidade: string | null
  unidade: string | null
}): AdhocItemValidation {
  const nome = input.nome.trim()
  if (nome === '' || Array.from(nome).length > SHOPPING_LIST_ITEM_NOME_MAX) {
    return { ok: false, reason: 'nome_invalido' }
  }
  if (input.unidade != null && !isUnidade(input.unidade)) {
    return { ok: false, reason: 'unidade_invalida' }
  }
  if (!isValidItemQuantidade(input.quantidade)) {
    return { ok: false, reason: 'quantidade_invalida' }
  }
  return {
    ok: true,
    nome,
    quantidade: input.quantidade,
    unidade: input.unidade as Unidade | null,
  }
}
