/**
 * Sinal "sua conta foi excluída" (#595). Depois de excluir a conta, o diálogo deixa o sinal no
 * sessionStorage e recarrega a home; o `AccountDeletedNotice` (montado no layout) consome o sinal e
 * mostra o aviso. Mesmo desenho do pedido de tour (`onboarding/tour-signal.ts`): sessionStorage e não
 * query string, para nada entrar no histórico nem no `?q=` da home.
 */

export const ACCOUNT_DELETED_KEY = 'refogando:conta:excluida'
/** O sinal vale por 30s: se a ida até a home for abandonada, o aviso não aparece numa visita posterior. */
export const ACCOUNT_DELETED_TTL_MS = 30_000

export function markAccountDeleted(): void {
  try {
    window.sessionStorage.setItem(ACCOUNT_DELETED_KEY, String(Date.now()))
  } catch {
    // Storage bloqueado: a conta foi excluída do mesmo jeito; só o aviso da home não aparece.
  }
}

/** Lê e apaga o sinal pendente. `true` = havia um sinal recente (mostra o aviso uma vez). */
export function consumeAccountDeletedSignal(now: number = Date.now()): boolean {
  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_DELETED_KEY)
    if (raw === null) return false
    window.sessionStorage.removeItem(ACCOUNT_DELETED_KEY)
    const at = Number(raw)
    return Number.isFinite(at) && now - at >= 0 && now - at <= ACCOUNT_DELETED_TTL_MS
  } catch {
    return false
  }
}
