import { and, eq, isNull } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { account, accountClosure, session, users, verification } from '@/db/schema'
import { erasedIdentity } from '@/domain/account-erasure'
import type { AccountClosureReason } from '@/domain/account-closure'
import { getImageStore } from '@/server/deps'
import { deleteOrphanBlobsConcurrently } from '@/server/images/image-blobs'
import { canDeleteAccountAvatar } from '@/server/images/avatar-blob'
import { recordDsarEvent } from '@/server/legal/dsar-audit'
import { purgePrivateContentInTx } from '@/server/legal/private-content'

/**
 * Núcleo da ELIMINAÇÃO da conta (issue #401, GAP-6; #473, ADR-0050; LGPD Art. 18 VI + Art. 16;
 * `docs/legal/takedown-e-remocao-titular.md` §6/§8). No self-service, SÓ o próprio titular (o route já passou por
 * `requireFreshSession`; aqui só recebemos o `session.user.id` — NUNCA um id vindo do cliente ⇒ sem IDOR). Um id
 * vindo do cliente só entra pelo encerramento da equipe, atrás de `requireFreshRole('admin')` (#606).
 *
 * Numa transação só (ou tudo, ou nada):
 *  1. ANONIMIZA a PII do usuário: email/name/handle → forma anonimizada ESTÁVEL (derivada do `id`
 *     opaco, `erasedIdentity`); avatar/bio/locale zerados; links → `[]`; as Restrições salvas (ADR-0041,
 *     dado sensível) → `[]`; o Nível de habilidade padrão (#421) → null. Irreversível (é o ponto do
 *     direito de eliminação).
 *  2. BLOQUEIA a conta: `deletedAt` (o gate de `requireSession` passa a barrar com 401) + carimba
 *     `anonymizedAt`. O carimbo marca a eliminação para a varredura diária do conteúdo privado (rede de
 *     segurança das corridas, `purgeAnonymizedPrivateContent`) e ancora o expurgo das fotos das avaliações
 *     180 dias depois (`purgeAnonymizedAccounts`).
 *  3. DESLOGA/INVALIDA: apaga TODAS as `session` do usuário (logout em todo lugar), as linhas de
 *     `account` (credenciais/tokens OAuth — remove PII de login e impede re-login) e as linhas de
 *     `verification` do titular: as de `identifier` = e-mail REAL (verificação de e-mail pendente guarda o
 *     e-mail em claro) e as de `value` = id (tokens do link de senha e marcadores do teto de e-mails,
 *     como em `pending-signup-purge.ts`). Não é gate de auth (a `account` já foi apagada), é higiene de PII
 *     no fluxo cujo propósito é justamente removê-la.
 *  4. APAGA o conteúdo PRIVADO e limpa as sessões de criação (`purgePrivateContentInTx`, regra e motivo lá):
 *     Receitas privadas e as imagens delas, galeria sem referência, Transcrições, texto livre, Briefings,
 *     coleções, saves, listas de compras, follows, notificações recebidas, Plano de refeições e Despensa.
 *  5. AUDITA: grava um evento `DSAR_RECEIVED` (canal `self_service`) com as CONTAGENS do que saiu (nunca
 *     ids nem texto) — espelha `clearSourceAttribution`/`createTakedownTicket`.
 *
 * FICAM, com o autor anonimizado: as Receitas PÚBLICAS e as avaliações (terceiros dependem delas — saves,
 * avaliações e agregados de outras pessoas), as denúncias que o titular registrou (prova do processo de
 * moderação) e os ledgers de uso até a retenção deles (ADR-0050). Os blobs (avatar, imagens, fotos das
 * avaliações que caíram em cascata) saem DEPOIS do commit, best-effort e com concorrência limitada.
 *
 * IDEMPOTENTE: se a conta já está eliminada (`deletedAt` != null), é no-op (`kind: 'already_erased'`) —
 * o UPDATE tem `WHERE deletedAt IS NULL`, então re-chamar não regrava nem re-audita.
 *
 * DOIS GATILHOS, UM NÚCLEO (`eraseAccount`, #606): o titular (`eraseOwnAccount`, a rota `/api/me/erasure`) e a
 * equipe (`closeAccountByAdmin`, Console → Usuários: menor de 16 ou violação grave, ADR-0051 P1/P3). Os passos 1 a 4
 * são os mesmos. Só o passo 5 muda: sem `decision`, o evento DSAR self-service de sempre; com `decision`, uma linha
 * em `account_closure` (decisão do controlador, não pedido do titular) e NENHUM evento DSAR.
 */

export type EraseAccountResult =
  | { kind: 'erased' } //         eliminou nesta chamada
  | { kind: 'already_erased' } // conta já estava eliminada (no-op idempotente)
  | { kind: 'not_found' } //      corrida improvável: a linha sumiu entre o guard e o UPDATE

/**
 * A decisão da equipe que dispara a eliminação (#606): o que vai para `account_closure`. Sem texto livre e sem dado
 * pessoal; `decidedBy` é o admin da sessão.
 */
export type AccountClosureDecision = {
  reason: AccountClosureReason
  removedPublicContent: boolean
  notifiedByEmail: boolean
  decidedBy: string
}

/** Eliminação self-service do titular: o núcleo sem decisão da equipe (passo 5 = evento DSAR `self_service`). */
export function eraseOwnAccount(db: Database, input: { userId: string }): Promise<EraseAccountResult> {
  return eraseAccount(db, { userId: input.userId })
}

/**
 * O núcleo da eliminação (ver o módulo). `decision` presente = encerramento pela equipe: o passo 5 grava a linha de
 * `account_closure` na mesma transação, em vez do evento DSAR.
 */
export async function eraseAccount(
  db: Database,
  input: { userId: string; decision?: AccountClosureDecision },
): Promise<EraseAccountResult> {
  const { userId, decision } = input
  const anon = erasedIdentity(userId)
  const now = new Date()

  // Captura a URL do avatar fora da tx para reap pós-commit: o passo 1 NULA `users.image`, então sem capturá-la
  // aqui a URL se perde e o blob fica órfão eternamente. Só é apagada se for avatar DESTA conta
  // (`canDeleteAccountAvatar`, #604): URL estrangeira (Google OAuth) e blob de outra pessoa NUNCA são apagados.
  let oldImageUrl: string | null = null

  const result = await db.transaction(async (tx) => {
    // Guarda a linha contra corrida e confirma o estado atual (existe? já eliminada?).
    const [current] = await tx
      .select({ id: users.id, email: users.email, image: users.image, deletedAt: users.deletedAt })
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
    oldImageUrl = current.image

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
        // A linha `users` SOBREVIVE à eliminação (anonimizada), então o que não é identidade estável é
        // ZERADO aqui. Restrições salvas (ADR-0041, dado sensível — LGPD Art. 11):
        restricoes: [],
        // ...e a prova do consentimento delas (#600): sem restrições, não há consentimento a provar.
        restricoesConsentidasEm: null,
        restricoesConsentimentoVersao: null,
        // Nível de habilidade padrão (#421):
        nivelPadrao: null,
        // Os básicos da Despensa (ADR-0042) somem com a Despensa: privados, só do titular.
        pantryBasics: null,
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
    // E os que guardam o id em `value`: tokens do link de senha e marcadores do teto de e-mails.
    await tx.delete(verification).where(eq(verification.value, userId))

    // 4. Conteúdo privado e sessões de criação (o núcleo compartilhado com a varredura diária).
    const purge = await purgePrivateContentInTx(tx, userId, now)

    // 5. Registro. Encerramento pela equipe (#606): a decisão vai para `account_closure` (append-only, só o fato:
    //    motivo, conteúdo público removido, aviso tentado, quem decidiu) e NÃO há evento DSAR: não é pedido do titular.
    if (decision) {
      await tx.insert(accountClosure).values({
        userId,
        reason: decision.reason,
        removedPublicContent: decision.removedPublicContent,
        notifiedByEmail: decision.notifiedByEmail,
        decidedBy: decision.decidedBy,
      })
    } else {
      // Self-service: trilha de auditoria (append-only, minimizada): só metadados NÃO-sensíveis (o fato de
      // anonimizar, sessões revogadas e as contagens do que saiu). NUNCA ids nem a PII removida em claro.
      await recordDsarEvent(tx, {
        eventType: 'DSAR_RECEIVED',
        channel: 'self_service', // titular A (dono logado) — ≠ 'web_form' do titular B
        requestType: 'account_erasure',
        actorId: userId, // FK set-null: a prova sobrevive; a linha (anonimizada) NÃO é apagada aqui
        details: { anonymized: true, sessionsRevoked: revoked.length, ...purge.counts },
      })
    }

    return { kind: 'erased' as const, blobUrls: purge.blobUrls }
  })

  // Blobs DEPOIS do commit (best-effort; só apaga os NOSSOS — `store.owns` — e o avatar só se for da conta,
  // `canDeleteAccountAvatar`; nunca lança). Só quando de fato eliminamos nesta chamada (kind 'erased'):
  // já-eliminada/não-encontrada não têm nada novo a reapear.
  if (result.kind === 'erased') {
    const store = getImageStore()
    const avatar = (await canDeleteAccountAvatar(db, store, oldImageUrl, userId)) ? oldImageUrl : null
    await deleteOrphanBlobsConcurrently(store, [avatar, ...result.blobUrls])
    return { kind: 'erased' }
  }
  return result
}
