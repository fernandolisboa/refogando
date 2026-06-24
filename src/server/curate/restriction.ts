import { eq, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { decideModerationReason } from '@/domain/report'

/**
 * Restrição GRANULAR de geração de imagem por IA (#226, ADR-0022 dec.3 / 1º gancho do ADR-0007) —
 * a ação do Curador que BLOQUEIA/DESBLOQUEIA a geração de imagem por IA de um Usuário (abuso
 * confirmado). DISTINTA do ban de conta inteira (`users.banned`, ainda deferido): aqui só a
 * geração-por-IA é barrada — upload de foto e o resto da conta seguem funcionando.
 *
 * Espelha o estilo de `recipe/moderation.ts`: discriminated union que o route mapeia para HTTP,
 * REUSA `decideModerationReason` (motivo obrigatório não-vazio), e a 1ª proveniência preservada
 * (re-bloquear NÃO sobrescreve quem/quando/por quê — `ok_already_blocked`). O bloqueio é por-USUÁRIO
 * (não por receita): grava `image_gen_blocked_{at,by,reason}` em `users`. O CHECK de consistência do
 * banco garante `at` e `by` juntos ou ambos NULL.
 *
 *  - `blocked=true`  → bloqueia: motivo obrigatório; usuário-alvo deve existir; grava a proveniência
 *    (1ª vez) ou devolve `ok_already_blocked` (preserva a 1ª). Bloqueado = `image_gen_blocked_at ≠ null`.
 *  - `blocked=false` → desbloqueia: zera as 3 colunas (idempotente — desbloquear um já-desbloqueado → ok).
 *    O motivo NÃO é exigido para desbloquear.
 */

export type ImageGenRestrictionResult =
  | { kind: 'ok' } //                  200 — bloqueou/desbloqueou agora
  | { kind: 'ok_already_blocked' } //  200 — já estava bloqueado; preservou a 1ª proveniência
  | { kind: 'not_found' } //           404 — usuário-alvo inexistente
  | { kind: 'invalid_reason' } //      400 — motivo vazio (só no bloquear)

export async function setImageGenRestriction(input: {
  db: Database
  curatorId: string // session.user.id (route já passou pelo requireRole 'curador')
  targetUserId: string // já validado como uuid pelo route
  blocked: boolean
  reason?: string
}): Promise<ImageGenRestrictionResult> {
  const { db, curatorId, targetUserId, blocked, reason } = input

  return db.transaction(async (tx) => {
    // Carrega o estado ATUAL do alvo (existência + bloqueio vigente). FOR UPDATE serializa
    // bloqueios/desbloqueios concorrentes do mesmo usuário (preserva a 1ª proveniência sob corrida).
    const [target] = await tx
      .select({ blockedAt: users.imageGenBlockedAt })
      .from(users)
      .where(eq(users.id, targetUserId))
      .for('update')
    if (!target) return { kind: 'not_found' as const }

    if (blocked) {
      // Motivo obrigatório (mesmo idioma do remove-do-pool) — após existência, antes de qualquer write.
      if (!decideModerationReason({ reason: reason ?? '' }).allowed) {
        return { kind: 'invalid_reason' as const }
      }

      // Já bloqueado: NÃO sobrescreve a 1ª proveniência (quem/quando/por quê). Só confirma idempotente.
      if (target.blockedAt != null) return { kind: 'ok_already_blocked' as const }

      await tx
        .update(users)
        .set({
          imageGenBlockedAt: sql`now()`,
          imageGenBlockedBy: curatorId,
          imageGenBlockedReason: reason ?? '',
        })
        .where(eq(users.id, targetUserId))
      return { kind: 'ok' as const }
    }

    // Desbloquear: zera as 3 colunas (CHECK exige at e by juntos ⇒ ambos NULL). Idempotente.
    await tx
      .update(users)
      .set({ imageGenBlockedAt: null, imageGenBlockedBy: null, imageGenBlockedReason: null })
      .where(eq(users.id, targetUserId))
    return { kind: 'ok' as const }
  })
}
