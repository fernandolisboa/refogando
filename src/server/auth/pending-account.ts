/**
 * Conta PENDENTE de confirmação de email (#470) — o que ela expõe enquanto ninguém provou ser dono do email.
 *
 * Com a confirmação ligada, o cadastro responde igual exista ou não a conta; mas o `handle` derivado do `name`
 * escolhido por quem cadastra seria um oráculo (o `-2` da desambiguação, `/u/<handle>`, a busca de Cozinheiros).
 * Então a conta nasce com um handle ALEATÓRIO de espera (`pendente-<16 chars>`, impossível de derivar) e só
 * ganha o handle do nome quando o email é provado: link de confirmação (`afterEmailVerification`) ou link de
 * senha (`onPasswordReset` — ver B1 em auth.ts). Enquanto isso, as superfícies públicas a escondem
 * (`publicAccountFilter`). O prefixo `pendente-` é RESERVADO (`@/domain/handle`): ninguém o escolhe no perfil nem o
 * ganha do nome — só o cadastro de email+senha com a confirmação ligada o atribui.
 */
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { generateUniqueHandle } from '@/server/handle'
import { PENDING_HANDLE_PREFIX } from '@/domain/handle'

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
  return PENDING_HANDLE_PREFIX + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function isPendingHandle(handle: string | null | undefined): boolean {
  return typeof handle === 'string' && PENDING_RE.test(handle)
}

/**
 * CURA do handle de espera: troca-o pelo derivado do nome, com as MESMAS regras de colisão do cadastro
 * (`generateUniqueHandle`). Só mexe se o handle atual é EXATAMENTE o de espera gerado (`isPendingHandle`: formato
 * estrito — `pendente-silva` nunca casa) e o UPDATE é condicionado a ele (nada de sobrescrever um handle já
 * escolhido). `requireVerified`: só cura conta com email confirmado. Idempotente. Corrida com outro cadastro no
 * mesmo nome (23505) ⇒ tenta de novo; se esgotar, fica o de espera (editável no perfil) — confirmar/entrar nunca
 * falha por causa do handle.
 */
export async function assignNameHandle(userId: string, opts: { requireVerified?: boolean } = {}): Promise<void> {
  const db = getDb()
  const [row] = await db
    .select({ name: users.name, handle: users.handle, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, userId))
  if (!row || !isPendingHandle(row.handle)) return
  if (opts.requireVerified && !row.emailVerified) return
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
 * no perfil, nas rotas de seguir e na busca basta para ela não aparecer em lugar nenhum. Como o prefixo é
 * reservado, ninguém entra nesse filtro por escolher o handle.
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
