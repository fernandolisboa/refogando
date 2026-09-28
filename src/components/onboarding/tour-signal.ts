/**
 * Pedido de "fazer o tour de novo" (ADR-0039). O botão da página /guia não abre o tour ali (os alvos
 * vivem na home): ele deixa um pedido no sessionStorage e navega para a home, onde o `GuidedTour`
 * (montado no layout, que persiste entre navegações) consome o pedido e abre. O evento cobre o caso
 * de o pedido nascer já na home. sessionStorage e não query string: a home usa `?q=` para semear a
 * busca, e um parâmetro a mais ali entraria no histórico e nos links compartilhados.
 */

export const TOUR_START_EVENT = 'refogando:tour:start'
const START_KEY = 'refogando:tour:start'

export function requestTourStart(): void {
  try {
    window.sessionStorage.setItem(START_KEY, '1')
  } catch {
    // Storage bloqueado: o evento abaixo ainda abre o tour se o pedido nasceu na home.
  }
  window.dispatchEvent(new Event(TOUR_START_EVENT))
}

/** Lê e apaga o pedido pendente. `true` = havia um pedido (abre o tour uma vez). */
export function consumeTourStartRequest(): boolean {
  try {
    if (window.sessionStorage.getItem(START_KEY) !== '1') return false
    window.sessionStorage.removeItem(START_KEY)
    return true
  } catch {
    return false
  }
}
