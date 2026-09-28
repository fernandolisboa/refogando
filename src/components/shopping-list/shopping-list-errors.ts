import type { Messages } from '@/i18n/messages'

/**
 * Código de erro de "criar Lista de compras" (`POST /api/me/shopping-lists`, e o `newListName` do
 * gerar-lista do Cardápio) → mensagem localizada. Fonte única dos componentes que criam lista inline;
 * `fallback` é a mensagem genérica de quem chama.
 */
export function shoppingListCreateErrorMessage(
  code: string | undefined,
  m: Messages['listaDeCompras'],
  fallback: string = m.erro,
): string {
  switch (code) {
    case 'nome_invalido':
      return m.erroNomeInvalido
    case 'nome_duplicado':
      return m.erroNomeDuplicado
    case 'limite_listas':
      return m.erroLimiteListas
    default:
      return fallback
  }
}
