/**
 * Trava do harness de integração contra o banco de PRODUÇÃO (auditoria de segurança 2026-11-01, ARCH-01).
 *
 * Com `TEST_DATABASE_URL`, o harness cria `refogando_test_<rand>` no servidor apontado e varre os órfãos
 * `refogando_test_*` — com o papel dono, isso é DDL no servidor. O `.env.local` de dev já carregou a URL de
 * produção nessa variável; bastava um `source .env.local` (ou um agente que herdasse o env — incidente
 * 2026-09-09) para a suíte rodar contra o Neon de produção. Esta trava recusa ANTES de abrir conexão:
 *
 *  - o host de produção (`ep-gentle-morning-…`, com ou sem `-pooler`), nome que o CLAUDE.md já publica;
 *  - QUALQUER host igual ao de `DATABASE_URL`/`DATABASE_URL_UNPOOLED`/`POSTGRES_URL*` do mesmo ambiente — o
 *    banco da app nunca é o banco de teste, seja qual for o ambiente.
 *
 * Função pura (recebe o env) para o teste unitário cobrir sem tocar banco.
 */

/** Prefixo do endpoint Neon de produção (projeto misty-lake-71917023, branch main). */
export const PRODUCTION_DB_HOST_PREFIX = 'ep-gentle-morning-'

const APP_DB_VARS = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NO_SSL',
] as const

/** Host normalizado (minúsculo, sem o sufixo `-pooler` do Neon) ou null se a URL não parseia. */
function normalizedHost(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    return new URL(url.trim()).hostname.toLowerCase().replace('-pooler.', '.')
  } catch {
    return null
  }
}

/** Lança se alguma URL de teste aponta para produção ou para o banco da própria app. */
export function assertNotProductionTestDb(env: Record<string, string | undefined>): void {
  const testVars = ['TEST_DATABASE_URL', 'TEST_DATABASE_URL_UNPOOLED'] as const
  const appHosts = new Set(APP_DB_VARS.map((k) => normalizedHost(env[k])).filter((h): h is string => h !== null))

  for (const name of testVars) {
    const raw = env[name]
    if (!raw?.trim()) continue
    const host = normalizedHost(raw)
    if (host === null) throw new Error(`[harness] ${name} não é uma URL válida; recusando rodar a suíte.`)
    if (host.startsWith(PRODUCTION_DB_HOST_PREFIX)) {
      throw new Error(
        `[harness] ${name} aponta para o banco de PRODUÇÃO (${PRODUCTION_DB_HOST_PREFIX}…). ` +
          'Remova a variável (o harness sobe um Postgres via Testcontainers) ou use um projeto Neon de teste.',
      )
    }
    if (appHosts.has(host)) {
      throw new Error(
        `[harness] ${name} aponta para o mesmo host do banco da app (DATABASE_URL/POSTGRES_URL*). ` +
          'Use um servidor de teste separado.',
      )
    }
  }
}
