import { createHmac } from 'node:crypto'
import { and, eq, gt, inArray, isNull, like, lte, lt, ne, sql, type SQL } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import type { Database } from '@/db/client'
import {
  account,
  collection,
  creationSession,
  extractionEvent,
  imageGeneration,
  mealPlanEntry,
  mealPlanSuggestionEvent,
  notification,
  pantryItem,
  recipe,
  recipeReview,
  recipeSave,
  report,
  session,
  shoppingList,
  userFollow,
  users,
  verification,
} from '@/db/schema'

/**
 * EXPURGO de cadastros abandonados (#470 follow-up, ADR-0014). Com a confirmação de email ligada, qualquer um
 * cadastra qualquer email: a conta nasce não confirmada, com handle de espera e o marcador
 * `users.pending_signup_at`. Se ninguém prova o email, ela ficaria para sempre — ocupando o email de outra pessoa
 * (dado de terceiro que ninguém consentiu, LGPD Art. 6º III) e mantendo vivo o pré-sequestro (quem cadastrou
 * conhece a senha). Passado o prazo, a linha é APAGADA de verdade (exceção ao soft-delete do ADR-0014: nunca
 * houve dono nem conteúdo) e o email fica livre para um cadastro novo.
 *
 * A chave é o MARCADOR explícito — gravado só pelo cadastro de email+senha com o gate ligado e limpo quando
 * alguém prova o email ou entra na conta —, nunca o handle `pendente-`, o `email_verified` ou "sem sessão agora"
 * sozinhos (conta da era do gate desligado, liga/desliga do gate, contas OAuth: apagariam conta real). Esses
 * sinais entram só como guarda extra, no mesmo DELETE: não confirmada, não soft-deletada, sem sessão, sem conta
 * de provedor além da senha, sem link de senha ainda válido e sem NENHUMA linha nas tabelas que cairiam em
 * cascada com ela (`CONTENT_GUARDS`) nem Receita (recipe.owner_id é RESTRICT) — se a limpeza do marcador falhar
 * para alguém que já usa a conta, nada dele se perde. As condições da própria linha `users` ficam no WHERE do
 * DELETE (e não só no subselect) para o Postgres re-checá-las se uma confirmação concorrente atualizar a linha
 * antes do lock — a conta confirmada no meio da varredura escapa. Resíduo aceito: um PRIMEIRO login com o gate
 * desligado exatamente durante o DELETE (a sessão nova não altera a linha `users`, então o re-check não a vê).
 *
 * MEMÓRIA do expurgo: cada email expurgado deixa uma LÁPIDE (HMAC do email, sem o email em claro) na
 * `verification` por `PURGED_SIGNUP_MEMORY_MS`. Sem ela, quem pré-registra o email da vítima repetiria o
 * cadastro a cada expurgo, e cada conta nova mandaria à vítima um link de CONFIRMAÇÃO não pedido (que confirma a
 * conta com a senha do atacante). Com a lápide, o cadastro de um email já expurgado manda o "conclua seu
 * cadastro" (link de senha — quem abre define a senha), como o cadastro repetido de conta pendente já faz.
 *
 * `now` é INJETADO (testes com datas simuladas; o cron passa `new Date()`). Lote limitado por passada (o cron é
 * diário; um surto de cadastros abandonados sai em dias, sem uma transação longa). Idempotente.
 */

const HOUR_MS = 60 * 60 * 1000

/**
 * Idade do marcador a partir da qual o cadastro é expurgado (na passada diária seguinte). Maior que a validade do
 * link de confirmação (24h, `VERIFY_EXPIRES_IN_S` em auth.ts): esse link é um JWT sem estado, chaveado pelo email,
 * e nunca pode chegar vivo a uma conta NOVA do mesmo email. Links de senha pedidos perto do prazo seguram o
 * expurgo enquanto valem (guarda abaixo).
 */
export const PENDING_SIGNUP_MAX_AGE_MS = 48 * HOUR_MS

/** Teto de contas apagadas por passada. */
export const PENDING_SIGNUP_PURGE_BATCH = 100

/** Por quanto tempo o email expurgado é lembrado (lápide) — cadastros dele mandam o link de senha. */
export const PURGED_SIGNUP_MEMORY_MS = 90 * 24 * HOUR_MS

const PURGED_SIGNUP_PREFIX = 'pending-signup-purged:'

/**
 * Tabelas que CAEM EM CASCATA com o Usuário (FK `ON DELETE cascade`), fora `session` e `account` (guardas
 * próprias). Qualquer linha nelas é uso da conta ⇒ não expurga. Um teste confere esta lista contra as FKs do
 * schema: FK nova para `users` com cascade/restrict precisa entrar aqui.
 */
export const CONTENT_GUARDS: readonly AnyPgColumn[] = [
  collection.userId,
  creationSession.userId,
  extractionEvent.userId,
  imageGeneration.userId,
  mealPlanEntry.userId,
  mealPlanSuggestionEvent.userId,
  notification.recipientId,
  pantryItem.userId,
  recipe.ownerId,
  recipeReview.userId,
  recipeSave.userId,
  report.reporterId,
  shoppingList.userId,
  userFollow.followerId,
  userFollow.followeeId,
]

export type PendingSignupPurgeResult = {
  /** Cadastros pendentes apagados nesta passada. */
  pendingSignupsPurged: number
}

/**
 * Identificador da lápide: HMAC-SHA256 do email normalizado com o segredo do auth (sem o email em claro). Sem o
 * segredo, fail-closed fora de teste (mesma regra de auth.ts): uma lápide sem chave seria só um hash do email.
 * Trocar o `BETTER_AUTH_SECRET` desliga as lápides vivas (volta o comportamento anterior por até 90 dias).
 */
function purgedSignupIdentifier(email: string): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret && process.env.NODE_ENV !== 'test') throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
  const tag = createHmac('sha256', secret ?? '')
    .update(email.trim().toLowerCase())
    .digest('hex')
  return PURGED_SIGNUP_PREFIX + tag
}

/** Este email teve um cadastro pendente expurgado há menos de `PURGED_SIGNUP_MEMORY_MS`? */
export async function wasPendingSignupPurged(db: Database, email: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.identifier, purgedSignupIdentifier(email)), gt(verification.expiresAt, now)))
    .limit(1)
  return row !== undefined
}

function noneIn(column: AnyPgColumn): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM ${column.table} WHERE ${column} = ${users.id})`
}

export async function purgeStalePendingSignups(
  db: Database,
  now: Date,
  opts: { batch?: number } = {},
): Promise<PendingSignupPurgeResult> {
  const cutoff = new Date(now.getTime() - PENDING_SIGNUP_MAX_AGE_MS)
  // Condições da linha `users` — repetidas no DELETE para o re-check sob concorrência (ver doc do módulo).
  const staleUnproven = and(
    lt(users.pendingSignupAt, cutoff),
    eq(users.emailVerified, false),
    isNull(users.deletedAt),
  )

  return db.transaction(async (tx) => {
    const candidates = tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          staleUnproven,
          noneIn(session.userId),
          sql`NOT EXISTS (SELECT 1 FROM ${account} WHERE ${account.userId} = ${users.id} AND ${ne(account.providerId, 'credential')})`,
          // "Conclua seu cadastro" pedido perto do prazo: o link de senha (1h) segue valendo até expirar.
          sql`NOT EXISTS (SELECT 1 FROM ${verification} WHERE ${verification.value} = ${users.id}::text AND ${like(verification.identifier, 'reset-password:%')} AND ${gt(verification.expiresAt, now)})`,
          ...CONTENT_GUARDS.map(noneIn),
        ),
      )
      .orderBy(users.pendingSignupAt)
      .limit(opts.batch ?? PENDING_SIGNUP_PURGE_BATCH)

    const deleted = await tx
      .delete(users)
      .where(and(inArray(users.id, candidates), staleUnproven))
      .returning({ id: users.id, email: users.email })

    // Lápides vencidas saem a cada passada (a `verification` não tem limpeza própria para elas).
    await tx
      .delete(verification)
      .where(and(like(verification.identifier, `${PURGED_SIGNUP_PREFIX}%`), lte(verification.expiresAt, now)))
    if (deleted.length === 0) return { pendingSignupsPurged: 0 }

    // session/account saem em cascata (FK). A `verification` não tem FK: os tokens do link de senha e os
    // marcadores do teto de e-mails por conta guardam o id do Usuário em `value` — saem junto.
    await tx.delete(verification).where(
      inArray(
        verification.value,
        deleted.map((d) => d.id),
      ),
    )
    await tx.insert(verification).values(
      deleted.map((d) => ({
        identifier: purgedSignupIdentifier(d.email),
        value: 'purged',
        expiresAt: new Date(now.getTime() + PURGED_SIGNUP_MEMORY_MS),
      })),
    )
    return { pendingSignupsPurged: deleted.length }
  })
}
