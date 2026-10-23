/**
 * Sessão "recente" para ação destrutiva (#602). As sessões duram 7 dias e são renovadas com o uso; com um cookie
 * roubado ou num computador compartilhado ainda logado, bastaria um clique para excluir a conta de vez. A exclusão
 * exige uma sessão CRIADA (não renovada) há menos de 24 h, no espírito do `freshAge` do Better Auth: quem entrou
 * de novo há pouco provou a senha (ou o Google) nesse intervalo.
 *
 * Puro: o servidor (`requireFreshSession`) e a tela (o aviso no diálogo de exclusão) usam a mesma regra.
 */

/** Idade máxima da sessão, contada da criação, para excluir a conta. */
export const FRESH_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** A sessão criada em `createdAt` ainda é recente em `now`? Data ausente ou inválida ⇒ não (fail-closed). */
export function isFreshSession(
  createdAt: Date | string | null | undefined,
  now: Date = new Date(),
  maxAgeMs: number = FRESH_SESSION_MAX_AGE_MS,
): boolean {
  if (createdAt == null) return false
  const t = new Date(createdAt).getTime()
  if (!Number.isFinite(t)) return false
  return now.getTime() - t < maxAgeMs
}
