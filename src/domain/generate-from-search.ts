/**
 * "Gerar a partir da busca" — quando o termo digitado na Busca já serve de pedido para a IA. PURO.
 *
 * A Busca oferece gerar uma receita com o termo (link para `/create?q=`, nunca geração automática: cada
 * geração custa e consome a cota do usuário). Termo curto demais ("fr", "bo") vira pedido ruim, então
 * abaixo do mínimo a UI mostra a dica "digite mais algumas letras" em vez do atalho.
 *
 * Conta só letras (qualquer alfabeto) — dígitos/pontuação não fazem um prato ("12", "!!!").
 */
export const GENERATE_FROM_SEARCH_MIN_LETTERS = 4

export type SearchTermGenerability = 'none' | 'too_short' | 'ok'

export function searchTermGenerability(q: string): SearchTermGenerability {
  const letters = q.match(/\p{L}/gu)?.length ?? 0
  if (letters === 0) return 'none'
  return letters < GENERATE_FROM_SEARCH_MIN_LETTERS ? 'too_short' : 'ok'
}
