/**
 * Tradução ÚNICA de erro do cliente Better Auth → chave de `messages.auth` (#55, #469). Usada por entrar/criar
 * conta e pelas telas de redefinição de senha, para as três não divergirem.
 *
 * Regra: o que DISCRIMINA é `error.code` (SCREAMING_SNAKE), não o status — PASSWORD_TOO_SHORT é 400,
 * USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL é 422. Exceções, ambas sem `code` no corpo: 429 (rate limit do Better
 * Auth) e ausência de status E de code (fetch não completou ⇒ rede). NUNCA expõe `error.message` cru.
 */
export type AuthErrorKey =
  | 'erroCredencialInvalida'
  | 'erroEmailEmUso'
  | 'erroSenhaCurta'
  | 'erroLinkInvalido'
  | 'erroMuitasTentativas'
  | 'erroRede'
  | 'erroGenerico'

/** Forma mínima do erro do better-fetch (`{ ...corpo, status, statusText }`). */
export type AuthError = { status?: number; code?: string }

export function mapAuthError(error: AuthError): AuthErrorKey {
  if (error.status === 429) return 'erroMuitasTentativas'
  if (!error.code) return error.status ? 'erroGenerico' : 'erroRede'
  switch (error.code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'erroCredencialInvalida'
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'USER_ALREADY_EXISTS':
      return 'erroEmailEmUso'
    case 'PASSWORD_TOO_SHORT':
      return 'erroSenhaCurta'
    case 'INVALID_TOKEN':
      return 'erroLinkInvalido'
    default:
      return 'erroGenerico'
  }
}

/**
 * Token da tela "criar nova senha" a partir da query que o Better Auth monta no redirect (`?token=` válido ou
 * `?error=INVALID_TOKEN`). Qualquer `error`, token ausente/vazio ou repetido (array) ⇒ `null` (link morto).
 */
export function parseResetToken(query: { token?: string | string[]; error?: string | string[] }): string | null {
  if (query.error !== undefined) return null
  return typeof query.token === 'string' && query.token.length > 0 ? query.token : null
}
