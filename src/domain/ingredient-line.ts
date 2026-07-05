import type { IngredientView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { isUnidade } from '@/domain/vocabulary'
import { formatQuantityDisplay } from '@/domain/quantity-format'

/**
 * Linha legível de UM ingrediente — FONTE ÚNICA consumida pelo detalhe (`RecipeDetailView`) E pelo
 * JSON-LD (`recipe-seo`). Antes eram duas cópias byte-iguais (uma dizia "espelha a outra"); a
 * duplicação sustentava o bug da medida DUPLICADA ("320 g — 320 g de arroz arbóreo"), pois só uma
 * cópia seria corrigida. Unificado pra nunca mais divergir.
 *
 * CONTRATO (ADR-0012 Adendo 2, 2026-06-30): a medida estruturada (`quantidade`/`unidade`) é a fonte
 * ÚNICA da medida; `rawText` é o NOME do ingrediente SEM a medida ("arroz arbóreo", nunca "320 g de
 * arroz arbóreo"). A exibição COMPÕE PROSA NATURAL com plural correto (revoga o "zero gramática" do
 * Adendo anterior, reprovado na tela de produção — "site escrito errado parece email de phishing"):
 *   - não-contável (`g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada`):
 *     `"{qtd} {unidade flexionada} {conector} {nome}"` — "3 dentes de alho", "200 g de farinha".
 *     A UNIDADE flexiona por plural (`unitLabelFor`): qty ≠ 1 → plural; fração < 1 → singular.
 *     O conector é LOCALIZADO (`m.unidadeConector` — "de"/"of"), nunca hardcoded.
 *   - contável (`unidade`): LARGA a palavra "unidade" → `"{qtd} {nome}"` ("2 cebolas"); o plural do
 *     NOME já vem da fonte (nunca flexionamos o nome — ver abaixo).
 *   - `a_gosto`/`q_b`: SUFIXO sem traço → `"{nome} a gosto"` / `"{nome} q.b."`;
 *   - sem unidade mas COM quantidade (ex.: importação "3 cenouras médias") → `"{qtd} {nome}"`;
 *   - sem medida (qty null + unidade null): só `"{nome}"`.
 *
 * O NOME NUNCA é flexionado no render: ele já nasce concordando com a quantidade na geração/fonte, e
 * flexionar nome arbitrário quebraria os plurais especiais do pt-BR (coração/mão/-ão por dicionário,
 * concordância de sintagma). A flexão de nome SOB ESCALA (futuro `quantidade × ratio`) virá do
 * Ingrediente canônico (formas singular/plural na tradução do ADR-0001), não de um heurístico de
 * string. A unidade, ao contrário, é um conjunto FECHADO e REGULAR — daí o rótulo plural estático.
 *
 * Números/frações por locale via `formatQuantityDisplay` (vírgula pt / ponto en, sem zeros forçados,
 * frações comuns viram glifos ½ ⅓ ¼…). O 3º arg `locale` chega de todos os call sites (seo tem o
 * `locale` em escopo; `RecipeDetailView` recebe via prop; a fila do curador via `useLocale()`).
 *
 * FALLBACK defensivo (nome ausente/vazio — não ocorre em prod pós-migração de `raw_text`→nome):
 * exibe só a medida estruturada localizada, ao menos. Supera o remendo do PR #354, que exibia
 * `rawText` cru (a linha humana completa) — agora a linha é COMPOSTA da fonte única.
 */
export function formatIngredientLine(item: IngredientView, m: Messages, locale: string): string {
  const nome = item.rawText?.trim() ?? ''
  const hasQty = item.quantidade != null && item.quantidade !== ''
  const qtyFmt = hasQty ? formatQuantityDisplay(item.quantidade as string, locale) : null
  const qtyNum = hasQty ? Number((item.quantidade as string).replace(',', '.')) : null
  const unidade = item.unidade != null && item.unidade !== '' ? item.unidade : null

  // FALLBACK defensivo: sem nome, exibe só a medida estruturada (quantidade + unidade flexionada).
  // Em prod (pós-migração) `nome` é sempre o nome do ingrediente; este ramo é rede contra dado
  // malformado, e preserva o comportamento anterior do helper para esse caso de borda.
  if (nome === '') {
    const u = unidade != null ? unitLabelFor(unidade, qtyNum, m) : null
    return [qtyFmt, u].filter((p) => p != null && p !== '').join(' ')
  }

  // `a_gosto`/`q_b`: não-mensuráveis → SUFIXO sem traço; a quantidade (se houver, defensivo) é
  // ignorada. Usa o rótulo SINGULAR (são invariáveis: "a gosto"/"q.b.").
  if (unidade === 'a_gosto' || unidade === 'q_b') {
    return `${nome} ${m.unidadeLabel[unidade]}`
  }

  // Contável (`unidade`): larga a palavra "unidade" → "{qtd} {nome}" ("2 cebolas").
  if (unidade === 'unidade') {
    return qtyFmt != null ? `${qtyFmt} ${nome}` : nome
  }

  // Não-contável (demais unidades do enum) OU unidade fora do enum (defensivo, sai crua): compõe
  // "{qtd} {unidade flexionada} {conector} {nome}" — prosa natural, plural pela quantidade, conector
  // localizado. SÓ com quantidade — sem ela a unidade sozinha não é medida ("g de arroz" não diz
  // nada); larga o rótulo órfão e exibe só o nome.
  if (unidade != null) {
    return qtyFmt != null
      ? `${qtyFmt} ${unitLabelFor(unidade, qtyNum, m)} ${m.unidadeConector} ${nome}`
      : nome
  }

  // Sem unidade: quantidade solta (ex.: "3 cenouras médias") OU só o nome.
  return qtyFmt != null ? `${qtyFmt} ${nome}` : nome
}

/**
 * Rótulo da unidade FLEXIONADO pela quantidade. Unidade fora do enum (defensivo) sai crua. Plural
 * quando qty ≠ 1 E não é fração < 1 (qty===1 singular; 0<qty≤1 singular "½ xícara"; qty>1 incl. 2.5
 * plural; qty null não chega aqui pelo caminho não-contável, mas o singular é o default seguro).
 */
function unitLabelFor(unidade: string, qtyNum: number | null, m: Messages): string {
  if (!isUnidade(unidade)) return unidade
  const plural = qtyNum != null && !(qtyNum > 0 && qtyNum <= 1)
  return plural ? m.unidadeLabelPlural[unidade] : m.unidadeLabel[unidade]
}

/**
 * Escalador de porções (#452, CONTEXT.md:192 "`quantidade` × `ratio` permite escalar por porções
 * sem IA"): multiplica a `quantidade` estruturada por um fator positivo — ARITMÉTICA pura, nunca
 * geração/reprocessamento de texto. Arredonda a 3 casas (espelha `numeric(10,3)` da coluna) pra não
 * acumular ruído de ponto-flutuante ("2" × (3/4) não deve virar "1.4999999999999998").
 *
 * Item SEM quantidade estruturada (`null`/`''`) fica COMO ESTÁ (devolve o mesmo valor) — não há
 * medida pra escalar, e o texto (`rawText`) nunca é a fonte da medida (mesmo contrato do Adendo 2).
 */
export function scaleQuantidade(quantidade: string | null, factor: number): string | null {
  if (quantidade == null || quantidade === '') return quantidade
  const n = Number(quantidade.replace(',', '.'))
  if (!Number.isFinite(n)) return quantidade // defensivo: não-numérico sai cru, sem tentar escalar.
  return String(Math.round(n * factor * 1000) / 1000)
}

/**
 * Escala UM ingrediente pro fator de porções corrente — só `quantidade` muda; `unidade`/`rawText`
 * seguem intactos (a unidade não muda de natureza ao escalar; o nome nunca é flexionado por
 * heurística, ver contrato acima de `formatIngredientLine`).
 */
export function scaleIngredient(item: IngredientView, factor: number): IngredientView {
  if (item.quantidade == null || item.quantidade === '') return item
  return { ...item, quantidade: scaleQuantidade(item.quantidade, factor) }
}
