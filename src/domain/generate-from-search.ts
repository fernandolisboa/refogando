/**
 * "Gerar a partir da busca" — quando o termo digitado na Busca já serve de pedido para a IA. PURO.
 *
 * A Busca oferece gerar uma receita com o termo (link para `/create?q=`, nunca geração automática: cada
 * geração custa e consome a cota do usuário). Termo curto demais ("fr", "bo") vira pedido ruim, então
 * abaixo do mínimo a UI mostra a dica "digite mais algumas letras" em vez do atalho.
 *
 * Conta só letras (qualquer alfabeto) — dígitos/pontuação não fazem um prato ("12", "!!!").
 */
// 3, não 4: pratos de três letras são pedidos legítimos ("pão", "chá", "ovo", "pie", "jam").
export const GENERATE_FROM_SEARCH_MIN_LETTERS = 3

export type SearchTermReadiness = 'none' | 'too_short' | 'ok'

export function searchTermReadiness(q: string): SearchTermReadiness {
  const letters = q.match(/\p{L}/gu)?.length ?? 0
  if (letters === 0) return 'none'
  return letters < GENERATE_FROM_SEARCH_MIN_LETTERS ? 'too_short' : 'ok'
}

/** Folga para `/create?q=` dentro do teto de 512 do `safeInternalPath` (vale como `returnTo` do login). */
const MAX_ENCODED_TERM = 480

/**
 * Destino do "Gerar" a partir da busca (cartão do vazio e atalho sob os resultados): `/create?q=<termo>`
 * quando o termo serve de pedido; `/create` cru caso contrário (sem `?q=` espúrio, nem "123" pré-preenchido).
 */
export function createFromSearchHref(term: string): string {
  const t = fitEncoded(term.trim()).trim()
  return searchTermReadiness(t) === 'ok' ? `/create?q=${encodeURIComponent(t)}` : '/create'
}

/**
 * O destino também vira `returnTo` do login, que `safeInternalPath` recusa acima de 512 caracteres. Corta
 * o termo (por code point, sem partir acento/emoji) até caber, numa passada só (termo colado pode ser
 * enorme e isto roda a cada render). Exportado: o convite "Entrar para buscar na web" monta o mesmo
 * tipo de `returnTo` (`/<locale>?q=<termo>`).
 */
export function fitEncoded(t: string): string {
  let size = 0
  let out = ''
  for (const ch of t) {
    size += encodeURIComponent(ch).length
    if (size > MAX_ENCODED_TERM) break
    out += ch
  }
  return out
}
