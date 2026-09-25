/**
 * Conta PENDENTE de confirmação de email (#470) — o que ela expõe enquanto ninguém provou ser dono do email.
 *
 * Com a confirmação ligada, o cadastro responde igual exista ou não a conta; mas o `handle` derivado do `name`
 * escolhido por quem cadastra seria um oráculo (o `-2` da desambiguação, `/u/<handle>`, a busca de Cozinheiros).
 * Então a conta nasce com um handle ALEATÓRIO de espera (`pendente-<16 chars>`, impossível de derivar) e só
 * ganha o handle do nome quando o email é provado: link de confirmação (`afterEmailVerification`) ou link de
 * senha (`onPasswordReset` — ver B1 em auth.ts). Enquanto isso, as superfícies públicas a escondem
 * (`publicAccountFilter`), e a que nunca é provada é apagada depois de 48h (`purgeStalePendingAccounts`).
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { generateUniqueHandle } from '@/server/handle'

const PENDING_PREFIX = 'pendente-'

/** SQLSTATE do erro do Postgres (postgres.js embrulhado pelo Drizzle em `cause`) — como `pgCode` do recipe. */
function pgCode(err: unknown): string | undefined {
  const cause = (err as { cause?: { code?: unknown } } | null)?.cause?.code
  if (typeof cause === 'string') return cause
  const top = (err as { code?: unknown } | null)?.code
  return typeof top === 'string' ? top : undefined
}

const PENDING_RE = /^pendente-[a-z0-9]{16}$/
/** O mesmo formato, para o `~` do Postgres. */
const PENDING_PATTERN = '^pendente-[a-z0-9]{16}$'
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Handle de espera: `pendente-` + 16 chars aleatórios (cabe nos 30 do handle, formato válido, não reservado). */
export function pendingHandle(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return PENDING_PREFIX + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function isPendingHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && PENDING_RE.test(handle)
}

/**
 * Email provado ⇒ troca o handle de espera pelo derivado do nome, com as MESMAS regras de colisão do cadastro
 * (`generateUniqueHandle`). Só mexe se o handle atual ainda é o de espera (o UPDATE é condicionado a ele — nada
 * de sobrescrever um handle já escolhido). Corrida com outro cadastro no mesmo nome (23505) ⇒ tenta de novo;
 * se esgotar, fica o de espera (editável no perfil) — confirmar a conta nunca falha por causa do handle.
 */
export async function assignNameHandle(userId: string): Promise<void> {
  const db = getDb()
  const [row] = await db.select({ name: users.name, handle: users.handle }).from(users).where(eq(users.id, userId))
  if (!row || !isPendingHandle(row.handle)) return
  for (let attempt = 0; attempt < 3; attempt++) {
    const handle = await generateUniqueHandle(row.name)
    try {
      await db
        .update(users)
        .set({ handle, updatedAt: new Date() })
        .where(and(eq(users.id, userId), eq(users.handle, row.handle)))
      return
    } catch (err) {
      if (pgCode(err) !== '23505') throw err
    }
  }
}

/**
 * Filtro das superfícies PÚBLICAS de Usuário (perfil `/api/u/<handle>`, seguir/seguidores/seguindo, busca de
 * Cozinheiros): conta viva (`deletedAt` nulo) e, com a confirmação de email LIGADA, que não seja uma conta
 * PENDENTE — handle de espera E email não confirmado, ou seja, criada com o gate ligado e ainda não provada.
 * A chave é o handle de espera, não só `email_verified`: contas criadas não confirmadas com o gate DESLIGADO
 * (handle do nome, com conteúdo, seguidas por alguém) seguem públicas quando o gate liga — só precisam
 * confirmar no próximo login. Conta pendente não tem sessão, então nunca segue ninguém nem publica: esconder
 * no perfil, nas rotas de seguir e na busca basta para ela não aparecer em lugar nenhum.
 */
export function publicAccountFilter(verificationRequired: boolean): SQL {
  return verificationRequired
    ? sql`${users.deletedAt} IS NULL AND (${users.emailVerified} OR ${users.handle} !~ ${PENDING_PATTERN})`
    : isNull(users.deletedAt)
}

/** Mesmo filtro em SQL cru (para queries com `FROM users` sem alias). */
export function publicAccountSql(verificationRequired: boolean): SQL {
  return verificationRequired
    ? sql`users.deleted_at IS NULL AND (users.email_verified OR users.handle !~ ${PENDING_PATTERN})`
    : sql`users.deleted_at IS NULL`
}

/** Conta pendente sem prova do email por mais que isto é apagada (ver `purgeStalePendingAccounts`). */
export const PENDING_ACCOUNT_TTL_MS = 48 * 60 * 60 * 1000

/**
 * #470 (R1) — EXPURGO das contas pendentes velhas (cron `account-purge`). Fecha o que sobra do pré-sequestro: a
 * conta que um terceiro cadastrou com o email da vítima (e a senha dele) só vira conta de verdade se alguém
 * abrir um link do email; passadas 48h sem isso, ela some e o email fica livre para o dono cadastrar.
 * HARD-delete (exceção consciente ao soft-delete do ADR-0014): conta pendente nunca teve sessão, então não tem
 * conteúdo, seguidores nem avaliações — só a própria linha e a `account` de senha (FK em cascata). Critério
 * estrito: handle de espera, email NÃO confirmado, criada há mais de 48h, nenhuma sessão, nenhuma receita (a FK
 * `restrict` nunca dispararia, mas é a rede). Devolve só a contagem (sem PII). Idempotente.
 */
export async function purgeStalePendingAccounts(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - PENDING_ACCOUNT_TTL_MS)
  const deleted = await db.execute<{ id: string }>(sql`
    DELETE FROM users
    WHERE users.handle ~ ${PENDING_PATTERN}
      AND NOT users.email_verified
      AND users.created_at < ${cutoff.toISOString()}
      AND NOT EXISTS (SELECT 1 FROM session WHERE session.user_id = users.id)
      AND NOT EXISTS (SELECT 1 FROM recipe WHERE recipe.owner_id = users.id)
    RETURNING users.id
  `)
  return deleted.length
}
