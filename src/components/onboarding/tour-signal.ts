/**
 * Pedido de "fazer o tour de novo" (ADR-0039). O botão da página /guia não abre o tour ali (os alvos
 * vivem na home): ele deixa um pedido no sessionStorage e navega para a home, onde o `GuidedTour`
 * (montado no layout, que persiste entre navegações) consome o pedido e abre. O evento cobre o caso
 * de o pedido nascer já na home. sessionStorage e não query string: a home usa `?q=` para semear a
 * busca, e um parâmetro a mais ali entraria no histórico e nos links compartilhados.
 */

export const TOUR_START_EVENT = 'refogando:tour:start'
export const TOUR_START_KEY = 'refogando:tour:start'
/**
 * Um pedido vale por 30s: se a navegação até a home for abandonada (voltar, trocar de aba), o pedido
 * velho não abre o tour de surpresa numa visita posterior à home.
 */
export const TOUR_START_TTL_MS = 30_000

export function requestTourStart(): void {
  try {
    window.sessionStorage.setItem(TOUR_START_KEY, String(Date.now()))
  } catch {
    // Storage bloqueado: o evento abaixo ainda abre o tour se o pedido nasceu na home.
  }
  window.dispatchEvent(new Event(TOUR_START_EVENT))
}

/** Lê e apaga o pedido pendente. `true` = havia um pedido (abre o tour uma vez). */
export function consumeTourStartRequest(now: number = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(TOUR_START_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(TOUR_START_KEY)
    const at = Number(raw)
    return Number.isFinite(at) && now - at >= 0 && now - at <= TOUR_START_TTL_MS
  } catch {
    return false
  }
}
