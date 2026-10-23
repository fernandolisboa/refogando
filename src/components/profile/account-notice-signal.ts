/**
 * Sinal do aviso de conta depois da recarga (#595). A saída do diálogo de exclusão recarrega a página;
 * antes, deixa aqui o que o `AccountNotice` (montado no layout) deve dizer do outro lado:
 *  - `excluida`: a conta foi excluída ("Sua conta foi excluída.", na home do idioma);
 *  - `sessao`: a sessão tinha expirado e a exclusão não rodou (`erroSessao`, na mesma página).
 * Mesmo desenho do pedido de tour (`onboarding/tour-signal.ts`): sessionStorage e não query string, para
 * nada entrar no histórico nem no `?q=` da home.
 */

export type AccountNoticeKind = 'excluida' | 'sessao'

export const ACCOUNT_NOTICE_KEY = 'refogando:conta:aviso'
/** O sinal vale por 30s: se a recarga for abandonada, o aviso não aparece numa visita posterior. */
export const ACCOUNT_NOTICE_TTL_MS = 30_000

const KINDS: readonly AccountNoticeKind[] = ['excluida', 'sessao']

export function markAccountNotice(kind: AccountNoticeKind): void {
  try {
    window.sessionStorage.setItem(ACCOUNT_NOTICE_KEY, `${kind}:${Date.now()}`)
  } catch {
    // Storage bloqueado: a saída segue do mesmo jeito; só o aviso depois da recarga não aparece.
  }
}

/** Lê e apaga o sinal pendente: o tipo do aviso, se havia um sinal recente e válido (mostra uma vez). */
export function consumeAccountNotice(now: number = Date.now()): AccountNoticeKind | null {
  try {
    const raw = window.sessionStorage.getItem(ACCOUNT_NOTICE_KEY)
    if (raw === null) return null
    window.sessionStorage.removeItem(ACCOUNT_NOTICE_KEY)
    const sep = raw.indexOf(':')
    const kind = raw.slice(0, sep) as AccountNoticeKind
    const at = Number(raw.slice(sep + 1))
    if (sep < 0 || !KINDS.includes(kind) || !Number.isFinite(at)) return null
    return now - at >= 0 && now - at <= ACCOUNT_NOTICE_TTL_MS ? kind : null
  } catch {
    return null
  }
}
