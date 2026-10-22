/**
 * Constantes do harness do E2E (#589), compartilhadas pelo `playwright.config.ts`, pelo
 * `e2e/harness/server.ts` e pelo `e2e/harness/seed.ts`. Módulo folha, sem dependências.
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

/**
 * Nome SEGURO do banco descartável: `refogando_e2e_<epoch em segundos>_<aleatório>`. É a única forma que o
 * harness cria, semeia ou apaga (o nome entra cru no `CREATE`/`DROP DATABASE`). O 1º grupo é o instante
 * da criação, que a varredura de órfãos usa para não tocar no banco de outra execução em andamento.
 */
export const E2E_DB_NAME_RE = /^refogando_e2e_(\d{10,})_[a-z0-9]+$/
/** Banco do E2E mais velho que isto é órfão (execução morta por SIGKILL): a varredura apaga. */
export const E2E_ORPHAN_MIN_AGE_MS = 2 * 60 * 60 * 1000
