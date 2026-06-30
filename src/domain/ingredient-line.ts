import type { IngredientView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { isUnidade } from '@/domain/vocabulary'

/**
 * Linha legível de UM ingrediente — FONTE ÚNICA consumida pelo detalhe (`RecipeDetailView`) E pelo
 * JSON-LD (`recipe-seo`). Antes eram duas cópias byte-iguais (uma dizia "espelha a outra"); a
 * duplicação sustentava o bug da medida DUPLICADA ("320 g — 320 g de arroz arbóreo"), pois só uma
 * cópia seria corrigida. Unificado pra nunca mais divergir.
 *
 * CONTRATO (ADR-0012 Adendo 2026-06-30, Direção B): a medida estruturada (`quantidade`/`unidade`) é
 * a fonte ÚNICA da medida; `rawText` é o NOME do ingrediente SEM a medida ("arroz arbóreo", nunca
 * "320 g de arroz arbóreo"). A exibição COMPÕE "medida — nome" — em-dash, ZERO gramática (não
 * pluraliza a unidade, sem conector "de", locale-neutro):
 *   - não-contável (`g/kg/ml/l/colher_de_sopa/colher_de_cha/xicara/dente/fatia/pitada`):
 *     `"{qtd} {unitLabel} — {nome}"`;
 *   - contável (`unidade`): LARGA a palavra "unidade" → `"{qtd} {nome}"` ("2 cebolas"; o plural
 *     estático já vem no nome);
 *   - `a_gosto`/`q_b`: SUFIXO → `"{nome} — a gosto"` / `"{nome} — q.b."`;
 *   - sem unidade mas COM quantidade (ex.: importação "3 cenouras médias") → `"{qtd} {nome}"`;
 *   - sem medida (qty null + unidade null): só `"{nome}"`.
 *
 * Escalar por porções (futuro) = `quantidade × ratio` (aritmética, não IA); a flexão de plural sob
 * escala virá do Ingrediente canônico (deferido). A exibição estática NÃO flexiona: o nome já nasce
 * concordando com a quantidade gerada.
 *
 * FALLBACK defensivo (nome ausente/vazio — não ocorre em prod pós-migração de `raw_text`→nome):
 * exibe só a medida estruturada localizada, ao menos. Supera o remendo do PR #354, que exibia
 * `rawText` cru (a linha humana completa) — agora a linha é COMPOSTA da fonte única.
 */
export function formatIngredientLine(item: IngredientView, m: Messages): string {
  const nome = item.rawText?.trim() ?? ''
  const qtd =
    item.quantidade != null && item.quantidade !== '' ? formatQuantidade(item.quantidade) : null
  const unidade = item.unidade != null && item.unidade !== '' ? item.unidade : null

  // FALLBACK defensivo: sem nome, exibe só a medida estruturada (quantidade + unidade localizada).
  // Em prod (pós-migração) `nome` é sempre o nome do ingrediente; este ramo é rede contra dado
  // malformado, e preserva o comportamento anterior do helper para esse caso de borda.
  if (nome === '') {
    const u = unidade != null ? formatUnidade(unidade, m) : null
    return [qtd, u].filter((p) => p != null && p !== '').join(' ')
  }

  // `a_gosto`/`q_b`: não-mensuráveis → SUFIXO; a quantidade (se houver, defensivo) é ignorada.
  if (unidade === 'a_gosto' || unidade === 'q_b') {
    return `${nome} — ${formatUnidade(unidade, m)}`
  }

  // Contável (`unidade`): larga a palavra "unidade" → "{qtd} {nome}" ("2 cebolas").
  if (unidade === 'unidade') {
    return qtd != null ? `${qtd} ${nome}` : nome
  }

  // Não-contável (demais unidades do enum) OU unidade fora do enum (defensivo, sai crua):
  // compõe "{qtd} {unitLabel} — {nome}" (em-dash). SÓ com quantidade — sem ela, a unidade
  // sozinha não é medida ("g — arroz" não diz nada); larga o rótulo órfão e exibe só o nome.
  if (unidade != null) {
    return qtd != null ? `${qtd} ${formatUnidade(unidade, m)} — ${nome}` : nome
  }

  // Sem unidade: quantidade solta (ex.: "3 cenouras médias") OU só o nome.
  return qtd != null ? `${qtd} ${nome}` : nome
}

/** Tira zeros à direita do `numeric(10,3)` (`'2.500'`→`'2.5'`); não-número cai no cru (nunca `NaN`). */
function formatQuantidade(quantidade: string): string {
  const n = Number(quantidade)
  return Number.isFinite(n) ? String(n) : quantidade
}

/** Unidade do enum `UNIDADES` → rótulo localizado (`m.unidadeLabel`); fora do enum (defensivo) sai cru. */
function formatUnidade(unidade: string, m: Messages): string {
  return isUnidade(unidade) ? m.unidadeLabel[unidade] : unidade
}
