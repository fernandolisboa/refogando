import type { IngredientView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { isUnidade } from '@/domain/vocabulary'

/**
 * Linha legível de UM ingrediente — FONTE ÚNICA consumida pelo detalhe (`RecipeDetailView`) E pelo
 * JSON-LD (`recipe-seo`). Antes eram duas cópias byte-iguais (uma dizia "espelha a outra"); a
 * duplicação sustentava o bug da medida DUPLICADA ("320 g — 320 g de arroz arbóreo"), pois só uma
 * cópia seria corrigida. Unificado pra nunca mais divergir.
 *
 * CONTRATO: `rawText` é a LINHA DE EXIBIÇÃO do ingrediente — a LINHA HUMANA COMPLETA, com a medida.
 * É assim que TODA origem de produção a grava: IA (`ai_*`) e seed de catálogo (o modelo devolve "320 g
 * de arroz arbóreo"), `web_imported` (`recipe-import-parse`: "rawText carrega tudo"), `derive` (herda
 * da base), e o form de edição do dono (pré-preenche e edita a linha completa). O schema reforça:
 * "'a gosto' vive em rawText". `quantidade`/`unidade` são metadados ESTRUTURADOS ADVISÓRIOS
 * (escala/filtro/linking canônico) — o display NÃO os recompõe, senão duplica a medida. Logo: EXIBE
 * `rawText` direto; só quando falta (dado malformado) cai na medida estruturada como fallback.
 *
 * RESSALVA (contrato dividido): os forms HUMANOS de catálogo (`catalog-recipe-form`) e de edição
 * (`recipe-edit-form`) têm campos SEPARADOS de quantidade/unidade e PODERIAM gravar `rawText` só-nome.
 * Os placeholders agora guiam a LINHA COMPLETA (ex.: "500 g de feijão preto") pra conformar ao
 * contrato; verificado no DB de prod: 0 linhas são só-nome (todas trazem a medida embutida). Se uma
 * só-nome for gravada com medida estruturada à parte, o display mostra só o nome (a medida advisória
 * não é recomposta) — tradeoff aceito pra eliminar a duplicação; unificar o write-path (parsear a
 * linha como o importador faz) fica de follow-up.
 */
export function formatIngredientLine(item: IngredientView, m: Messages): string {
  const raw = item.rawText?.trim()
  if (raw) return raw
  // Fallback defensivo (rawText ausente/vazio): a medida estruturada, ao menos.
  const quantidade =
    item.quantidade != null && item.quantidade !== '' ? formatQuantidade(item.quantidade) : null
  const unidade = item.unidade != null && item.unidade !== '' ? formatUnidade(item.unidade, m) : null
  return [quantidade, unidade].filter((p) => p != null && p !== '').join(' ')
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
