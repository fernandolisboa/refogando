import { isCategoria } from '@/domain/vocabulary'
import type { Messages } from '@/i18n/messages'

/**
 * Rótulo exibido da categoria no locale de `m`: token conhecido ⇒ `m.categoriaLabel`; token fora do enum ⇒ o
 * próprio token (defensivo); ausente ⇒ `null`. FONTE ÚNICA do detalhe (`RecipeDetailView`) e do JSON-LD
 * (`recipeCategory`, ADR-0060 dec. 5), que precisa levar o MESMO texto que a página mostra.
 */
export function resolveCategoriaLabel(
  m: Pick<Messages, 'categoriaLabel'>,
  categoria: string | null | undefined,
): string | null {
  if (categoria == null) return null
  return isCategoria(categoria) ? m.categoriaLabel[categoria] : categoria
}
