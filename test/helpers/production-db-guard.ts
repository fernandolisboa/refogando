import { isLoopbackUrl } from '@/server/e2e/mode'

/**
 * Trava dos harnesses contra o banco de PRODUÇÃO (auditoria de segurança 2026-11-01, achado H-3).
 *
 * Com `TEST_DATABASE_URL`, o harness do Vitest cria `refogando_test_<rand>` no servidor apontado e varre os órfãos
 * `refogando_test_*`: com o papel dono, isso é DDL no servidor. O `.env.local` de dev já carregou a URL de
 * produção nessa variável; bastava um `source .env.local` (ou um agente que herdasse o env, incidente
 * 2026-09-09) para a suíte rodar contra o Neon de produção. Duas travas, as duas ANTES de abrir conexão:
 *
 *  - `assertNotProductionDbUrl`: o host de produção (`ep-gentle-morning-…`, com ou sem `-pooler`), nome que o
 *    CLAUDE.md já publica. Roda em `createThrowawayDb` sobre a URL que o helper VAI usar, nos dois harnesses
 *    (Vitest e E2E), seja qual for a variável de onde ela veio;
 *  - `assertNotProductionTestDb`: só no Vitest, compara `TEST_DATABASE_URL*` com as URLs do banco da app do
 *    mesmo ambiente (`DATABASE_URL*`, `POSTGRES_*`, `PGHOST*`). Mesmo servidor (host + porta) ⇒ recusa. Em
 *    loopback a regra não vale: um Postgres local é sempre de dev, e o harness só cria e apaga `refogando_test_*`.
 *
 * Funções puras (recebem a URL ou o env) para o teste unitário cobrir sem tocar banco. É rede de segurança,
 * não fronteira: quem quer furar consegue (um IP no lugar do nome, outro projeto). O alvo é o acidente.
 */

/** Prefixo do endpoint Neon de produção (projeto misty-lake-71917023, branch main). */
export const PRODUCTION_DB_HOST_PREFIX = 'ep-gentle-morning-'

/** Variáveis que o Vercel/Neon põem para o banco da app (URLs completas). */
const APP_DB_URL_VARS = [
  'DATABASE_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL',
  'POSTGRES_URL_NON_POOLING',
  'POSTGRES_URL_NO_SSL',
  'POSTGRES_PRISMA_URL',
] as const

/** Variáveis que trazem só o host do banco da app (sem porta: vale a 5432). */
const APP_DB_HOST_VARS = ['PGHOST', 'PGHOST_UNPOOLED', 'POSTGRES_HOST'] as const

const TEST_DB_VARS = ['TEST_DATABASE_URL', 'TEST_DATABASE_URL_UNPOOLED'] as const

const DEFAULT_PG_PORT = '5432'

/** Hostname minúsculo, sem o sufixo `-pooler` do Neon. */
function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace('-pooler.', '.')
}

/** `host:porta` normalizado (porta default 5432) ou null se a URL não parseia. */
function serverKey(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    const u = new URL(url.trim())
    if (!u.hostname) return null
    return `${normalizeHostname(u.hostname)}:${u.port || DEFAULT_PG_PORT}`
  } catch {
    return null
  }
}

/** A URL aponta para o endpoint de produção? URL que não parseia não é produção (quem conecta vai falhar). */
export function isProductionDbUrl(url: string): boolean {
  const key = serverKey(url)
  return key !== null && key.startsWith(PRODUCTION_DB_HOST_PREFIX)
}

/** Lança se `url` é o banco de produção. `source` nomeia a variável na mensagem de erro. */
export function assertNotProductionDbUrl(url: string, source: string): void {
  if (isProductionDbUrl(url)) {
    throw new Error(
      `[harness] ${source} aponta para o banco de PRODUÇÃO (${PRODUCTION_DB_HOST_PREFIX}…). ` +
        'Remova a variável (o harness sobe um Postgres via Testcontainers) ou use um projeto Neon de teste.',
    )
  }
}

/** Lança se alguma `TEST_DATABASE_URL*` aponta para produção ou para o servidor do banco da própria app. */
export function assertNotProductionTestDb(env: Record<string, string | undefined>): void {
  const appServers = new Set<string>()
  for (const k of APP_DB_URL_VARS) {
    const key = serverKey(env[k])
    if (key) appServers.add(key)
  }
  for (const k of APP_DB_HOST_VARS) {
    const host = env[k]?.trim()
    if (host) appServers.add(`${normalizeHostname(host)}:${DEFAULT_PG_PORT}`)
  }

  for (const name of TEST_DB_VARS) {
    const raw = env[name]?.trim()
    if (!raw) continue
    const key = serverKey(raw)
    if (key === null) throw new Error(`[harness] ${name} não é uma URL válida; recusando rodar a suíte.`)
    assertNotProductionDbUrl(raw, name)
    if (isLoopbackUrl(raw)) continue
    if (appServers.has(key)) {
      throw new Error(
        `[harness] ${name} aponta para o mesmo servidor do banco da app (DATABASE_URL/POSTGRES_*/PGHOST*). ` +
          'Use um servidor de teste separado.',
      )
    }
  }
}
