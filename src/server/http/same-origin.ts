/**
 * Guarda de mesma origem por `Sec-Fetch-Site` (#595) — defesa em profundidade contra CSRF nas rotas
 * de ação consequente fora do Better Auth (o `trustedOrigins` dele só cobre `/api/auth/*`), e contra o
 * download forçado por outro site no export.
 *
 * O navegador moderno manda o cabeçalho em toda requisição e o site não consegue forjá-lo. Presente e
 * fora de `allowed` ⇒ bloquear. AUSENTE (curl, testes, navegador antigo) ⇒ não bloqueia: aí vale o
 * cookie `SameSite=Lax` do Better Auth, como antes. `same-site` também bloqueia: um subdomínio é
 * "mesmo site" para o Lax, mas não é a nossa origem.
 *
 * `allowed` é por rota: `POST /api/me/erasure` aceita só `same-origin` (o padrão); `GET /api/me/export`
 * aceita também `none` (o endereço digitado na barra ou aberto de um favorito).
 *
 * Parecida com a regra do intake de `/api/client-errors` (`client-error-intake.ts`), mas não igual: lá um
 * cabeçalho vazio passa como se faltasse e o valor é comparado cru; aqui só a AUSÊNCIA passa (vazio
 * bloqueia) e o valor é normalizado (sem espaços nas pontas, em minúsculas) antes de comparar.
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
