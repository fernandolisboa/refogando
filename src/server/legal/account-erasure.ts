import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { account, session, users, verification } from '@/db/schema'
import { erasedIdentity } from '@/domain/account-erasure'
import { recordDsarEvent } from '@/server/legal/dsar-audit'

/**
 * Núcleo da ELIMINAÇÃO self-service da própria conta (issue #401, GAP-6; LGPD Art. 18 VI + Art. 16;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). SÓ o próprio titular (o route já passou por
 * `requireSession`; aqui só recebemos o `session.user.id` — NUNCA um id vindo do cliente ⇒ sem IDOR).
 *
 * Eliminação CONSERVADORA (bloqueio lógico + anonimização — NÃO um hard-delete afobado):
 *  1. ANONIMIZA a PII do usuário: email/name/handle → forma anonimizada ESTÁVEL (derivada do `id`
 *     opaco, `erasedIdentity`); avatar/bio/locale zerados; links → `[]`. Irreversível (é o ponto do
 *     direito de eliminação).
 *  2. BLOQUEIA a conta: `deletedAt` (o gate de `requireSession` passa a barrar com 401) + carimba
 *     `anonymizedAt` (marca a erasure e ancora o expurgo físico pós-retenção — job FUTURO).
 *  3. DESLOGA/INVALIDA: apaga TODAS as `session` do usuário (logout em todo lugar), as linhas de
 *     `account` (credenciais/tokens OAuth — remove PII de login e impede re-login) e as linhas de
 *     `verification` cujo `identifier` é o e-mail REAL do titular (tokens de reset-de-senha /
 *     verificação-de-e-mail pendentes guardam o e-mail em claro; sobreviveriam à eliminação até
 *     expirar — expurgamos essa PII residual na mesma tx). Não é gate de auth (a `account` já foi
 *     apagada), é higiene de PII no fluxo cujo propósito é justamente removê-la.
 *  4. AUDITA: grava um evento `DSAR_RECEIVED` (canal `self_service`) na MESMA transação (atomicidade:
 *     ou elimina-E-audita, ou nada — espelha `clearSourceAttribution`/`createTakedownTicket`).
 *
 * O CONTEÚDO do usuário (receitas, avaliações, saves) é MANTIDO (owner_id segue apontando para a linha
 * anonimizada): apagá-lo em cascata destruiria dados dos quais TERCEIROS dependem (ex.: avaliações
 * numa receita, agregados) — decisão de produto/jurídica documentada no PR (default conservador +
 * reversível-no-curto-prazo). O EXPURGO FÍSICO pós-retenção é follow-up (não há job aqui).
 *
 * IDEMPOTENTE: se a conta já está eliminada (`deletedAt` != null), é no-op (`kind: 'already_erased'`) —
 * o UPDATE tem `WHERE deletedAt IS NULL`, então re-chamar não regrava nem re-audita.
 */

export type EraseAccountResult =
  | { kind: 'erased' } //         eliminou nesta chamada
  | { kind: 'already_erased' } // conta já estava eliminada (no-op idempotente)
  | { kind: 'not_found' } //      corrida improvável: a linha sumiu entre o guard e o UPDATE

export async function eraseOwnAccount(
  db: Database,
  input: { userId: string },
): Promise<EraseAccountResult> {
  const { userId } = input
  const anon = erasedIdentity(userId)
  const now = new Date()

  return db.transaction(async (tx) => {
    // Guarda a linha contra corrida e confirma o estado atual (existe? já eliminada?).
    const [current] = await tx
      .select({ id: users.id, email: users.email, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update')
    if (!current) return { kind: 'not_found' as const }
    if (current.deletedAt != null) return { kind: 'already_erased' as const }

    // Captura o e-mail REAL do titular ANTES de sobrescrevê-lo (passo 1) — é a chave para achar as
    // linhas de `verification` pendentes a expurgar (passo 3). Guarda a idempotência: só é PII a
    // apagar quando o e-mail atual ainda NÃO é a sentinela anonimizada desta conta (2ª chamada nem
    // chega aqui pelo guard de `deletedAt`, mas o check mantém o DELETE um no-op seguro).
    const oldEmail = current.email

    // 1+2. Anonimiza a PII e bloqueia/carimba. WHERE deletedAt IS NULL: só a 1ª eliminação escreve
    // (idempotência no próprio SQL, além do guard acima).
    const updated = await tx
      .update(users)
      .set({
        email: anon.email,
        name: anon.name,
        handle: anon.handle,
        image: null,
        bio: null,
        links: [],
        locale: null,
        deletedAt: now,
        anonymizedAt: now,
        updatedAt: now,
      })
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .returning({ id: users.id })
    if (updated.length === 0) return { kind: 'already_erased' as const }

    // 3. Desloga em todo lugar + remove credenciais/tokens (PII de login).
    const revoked = await tx.delete(session).where(eq(session.userId, userId)).returning({ id: session.id })
    await tx.delete(account).where(eq(account.userId, userId))
    // Expurga tokens de verificação/reset pendentes cujo `identifier` é o e-mail REAL (PII em claro).
    // Guardado contra a sentinela p/ manter idempotência (2ª execução = no-op).
    if (oldEmail !== anon.email) {
      await tx.delete(verification).where(eq(verification.identifier, oldEmail))
    }

    // 4. Trilha de auditoria (append-only, minimizada): só metadados NÃO-sensíveis (contagem de
    //    sessões revogadas + o fato de anonimizar). NUNCA a PII removida em claro.
    await recordDsarEvent(tx, {
      eventType: 'DSAR_RECEIVED',
      channel: 'self_service', // titular A (dono logado) — ≠ 'web_form' do titular B
      requestType: 'account_erasure',
      actorId: userId, // FK set-null: a prova sobrevive; a linha (anonimizada) NÃO é apagada aqui
      details: { anonymized: true, sessionsRevoked: revoked.length },
    })

    return { kind: 'erased' as const }
  })
}
