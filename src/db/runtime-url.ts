/**
 * Qual URL de banco a app usa em RUNTIME (#644, ADR-0058).
 *
 * `APP_DATABASE_URL` é a conexão do papel `app_rw`, que só lê e grava linhas (DML, sem DDL). Quando existe, ela
 * vence. Sem ela, a app segue com `DATABASE_URL`, que é a conexão do dono, a mesma que a integração do Neon
 * entrega e que o build usa para migrar. Assim o código pode ir para produção antes de a variável existir, e o
 * Preview (que só tem `DATABASE_URL`, da branch do PR) continua como estava.
 *
 * As migrações NÃO passam por aqui: `drizzle.config.ts` e `scripts/migrate` leem a URL do dono.
 */

type Env = Record<string, string | undefined>

export type RuntimeDbSource = 'APP_DATABASE_URL' | 'DATABASE_URL'

export type RuntimeDbUrl = { url: string; source: RuntimeDbSource }

/** `null` quando nenhuma das duas está definida (string vazia ou só espaços contam como ausente). */
export function resolveRuntimeDatabaseUrl(env: Env = process.env): RuntimeDbUrl | null {
  const app = env.APP_DATABASE_URL?.trim()
  if (app) return { url: app, source: 'APP_DATABASE_URL' }
  const owner = env.DATABASE_URL?.trim()
  if (owner) return { url: owner, source: 'DATABASE_URL' }
  return null
}

/**
 * O papel (usuário) da URL, para a linha de log do boot. Nunca devolve a senha nem o host. Nome de papel do
 * Postgres tem até 63 bytes; qualquer coisa fora de `[A-Za-z0-9_-]` vira `_` para a linha ficar parseável.
 */
export function dbRoleFromUrl(url: string): string {
  let user: string
  try {
    user = decodeURIComponent(new URL(url).username)
  } catch {
    return 'desconhecido'
  }
  if (!user) return 'desconhecido'
  return user.slice(0, 63).replace(/[^A-Za-z0-9_-]/g, '_')
}
