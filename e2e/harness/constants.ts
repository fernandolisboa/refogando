/**
 * Constantes do harness do E2E (#589), compartilhadas pelo `playwright.config.ts` e pelo
 * `e2e/harness/server.ts`. Sem imports `@/` (o config roda no processo do Playwright).
 *
 * SEMPRE `localhost` (nunca 127.0.0.1): o cookie de sessão e o `trustedOrigins` do Better Auth casam pelo
 * host de `BETTER_AUTH_URL`; misturar os dois vira cookie que não volta.
 */
export const E2E_PORT = 3100
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`
/** Segredo descartável (≥32 chars) — o servidor do E2E só vive durante a execução. */
export const E2E_AUTH_SECRET = 'e2e_refogando_segredo_descartavel_0123456789'
/** Marcador gravado pelo build do harness; `E2E_SKIP_BUILD=1` só vale com ele presente. */
export const E2E_BUILD_MARKER = '.next/e2e-build.json'
