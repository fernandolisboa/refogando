import type { IngredientView } from '@/domain/recipe-read'
import type { Messages } from '@/i18n/messages'
import { isUnidade } from '@/domain/vocabulary'

/**
 * Linha legível de UM ingrediente — FONTE ÚNICA consumida pelo detalhe (`RecipeDetailView`) E pelo
 * JSON-LD (`recipe-seo`). Antes eram duas cópias byte-iguais (uma dizia "espelha a outra"); a
 * duplicação sustentava o bug da medida DUPLICADA ("320 g — 320 g de arroz arbóreo"), pois só uma
 * cópia seria corrigida. Unificado pra nunca mais divergir.
 *
 * CONTRATO de `rawText`: é a LINHA HUMANA COMPLETA do ingrediente — INCLUI a medida — em TODA origem
 * de produção: IA (`ai_*`), seed de catálogo, `web_imported`, derive, e o que o form coleta (o campo
 * tem placeholder "Ex.: 1 cebola grande"; o schema diz "'a gosto' vive em rawText"). `quantidade`/
 * `unidade` são metadados ESTRUTURADOS (escala/filtro/linking canônico), NÃO se recompõem no display
 * — recompor com `${medida} — ${rawText}` duplicava a medida. Logo: EXIBE `rawText` direto. Só quando
 * ele falta (dado malformado, não ocorre em produção) cai na medida estruturada como fallback.
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
