/**
 * Guarda de mesma origem por `Sec-Fetch-Site` (#595) — defesa em profundidade contra CSRF nas rotas
 * de ação consequente fora do Better Auth (o `trustedOrigins` dele só cobre `/api/auth/*`). Mesma regra
 * do intake de `/api/client-errors` (`client-error-intake.ts`).
 *
 * O navegador moderno manda o cabeçalho em toda requisição e o site não consegue forjá-lo. Presente e
 * fora de `allowed` ⇒ bloquear. AUSENTE (curl, testes, navegador antigo) ⇒ não bloqueia: aí vale o
 * cookie `SameSite=Lax` do Better Auth, como antes. `same-site` também bloqueia: um subdomínio é
 * "mesmo site" para o Lax, mas não é a nossa origem.
 */

export const SAME_ORIGIN_ONLY = ['same-origin'] as const

/** `Sec-Fetch-Site` presente e fora de `allowed` ⇒ true (bloquear). Comparação com trim + minúsculas. */
export function isCrossSiteRequest(req: Request, allowed: readonly string[] = SAME_ORIGIN_ONLY): boolean {
  const site = req.headers.get('sec-fetch-site')
  if (site === null) return false
  return !allowed.includes(site.trim().toLowerCase())
}

/** 403 da guarda: chave de erro no estilo das outras (`dominio_nao_permitido`), nunca cacheado. */
export function crossSiteForbidden(): Response {
  return Response.json(
    { error: 'origem_nao_permitida' },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  )
}
