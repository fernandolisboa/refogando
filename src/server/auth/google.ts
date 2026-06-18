/**
 * Fonte ÚNICA da derivação "Google ligado?" (issue #55, server-only). A verdade é o par
 * de creds no servidor — NÃO há flag separado nem `NEXT_PUBLIC_*` (o repo evita de
 * propósito; ver base-url.ts). Tanto a instância Better Auth (auth.ts) quanto as pages de
 * autenticação (sign-in/sign-up) leem daqui, então UI e servidor nunca divergem: o botão
 * "Continuar com o Google" só aparece quando o provider está de fato configurado.
 *
 * Lê `process.env` em tempo de chamada (não no module-load) pra casar com a memoização
 * deferida de getAuth() e com o ambiente de teste.
 */
export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}
