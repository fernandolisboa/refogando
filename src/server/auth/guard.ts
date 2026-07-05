import { getAuth } from '@/lib/auth'
import { isRole, type Role } from '@/domain/user'
import { DEFAULT_PLAN, isPlan, type Plan } from '@/domain/plan'
import { decideRole } from '@/domain/access'

/**
 * Gating server-side (issue #5, ADR-0011). Devolve um discriminated union
 * `{ ok:true, session } | { ok:false, response }` — sem control-flow por exceção, casa
 * com o estilo `Response.json` dos handlers existentes. O handler faz:
 *
 *   const g = await requireRole(req, 'admin'); if (!g.ok) return g.response
 *
 * Regras (D8): 401 = Visitante (sem sessão) OU conta soft-deletada (D4, deletedAt != null);
 * 403 = autenticado com papel insuficiente (ou papel desconhecido — fail-closed via E11).
 * Corpo de erro sempre `{ error: '<chave>' }`.
 *
 * `session.user.role` é `Role | null`: `null` representa um valor de papel que NÃO está
 * em `ROLES` (não deveria ocorrer com o pgEnum, mas o guard é fail-closed se ocorrer).
 */

// Session/GuardResult são internos (sem consumidor externo): export removido (QM-4).
// Os handlers só importam requireSession/requireRole, nunca esses tipos.
type Session = { user: { id: string; role: Role | null; plan: Plan; deletedAt: Date | null } }
type GuardOk = { ok: true; session: Session }
type GuardFail = { ok: false; response: Response }
type GuardResult = GuardOk | GuardFail

/** Shape mínimo lido de getSession — o adapter pode entregar role/plan como string crua. */
type RawSessionUser = {
  id: string
  role?: string | null
  plan?: string | null
  deletedAt?: Date | string | null
}

/**
 * Normaliza o `user` cru de getSession para o nosso `Session` (papel desconhecido → null). `plan`
 * (#466): ausente/desconhecido ⇒ FAIL-SAFE em `DEFAULT_PLAN` (`free`) — nunca concede `pro` por engano
 * (o plano só sobe por billing, Fase 2). Com cookieCache OFF, o valor é relido VIVO do DB a cada request.
 */
function toSession(user: RawSessionUser): Session {
  const role: Role | null = typeof user.role === 'string' && isRole(user.role) ? user.role : null
  const plan: Plan = typeof user.plan === 'string' && isPlan(user.plan) ? user.plan : DEFAULT_PLAN
  const deletedAt = user.deletedAt == null ? null : new Date(user.deletedAt)
  return { user: { id: user.id, role, plan, deletedAt } }
}

/** 401 se sem sessão ou conta soft-deletada (D4). */
export async function requireSession(req: Request): Promise<GuardResult> {
  const raw = await getAuth().api.getSession({ headers: req.headers })
  const user = raw?.user as RawSessionUser | undefined
  if (!user) {
    return { ok: false, response: Response.json({ error: 'nao_autenticado' }, { status: 401 }) }
  }
  // E5 — soft-delete sem seam: a sessão é válida, mas a conta foi desativada (deletedAt
  // != null). Barramos com 401 conta_desativada. cookieCache fica OFF (senão ficaria stale).
  if (user.deletedAt != null) {
    return { ok: false, response: Response.json({ error: 'conta_desativada' }, { status: 401 }) }
  }
  return { ok: true, session: toSession(user) }
}

/** 401 sem sessão / conta desativada; 403 se papel < mínimo (fail-closed, E11). */
export async function requireRole(req: Request, min: Role): Promise<GuardResult> {
  const r = await requireSession(req)
  if (!r.ok) return r
  // FAIL-CLOSED (#51): só `allow` passa. `requireSession` já tratou ausência de sessão (401),
  // então um papel `null`/desconhecido que chega aqui é um usuário AUTENTICADO com papel fora
  // de `ROLES` → decideRole devolve `unauthenticated`/`forbidden`; QUALQUER coisa que não seja
  // `allow` vira 403. (Barrar só em `forbidden` era fail-OPEN: `null` → `unauthenticated` passava.)
  if (decideRole(r.session.user.role, min) !== 'allow') {
    return { ok: false, response: Response.json({ error: 'papel_insuficiente' }, { status: 403 }) }
  }
  return r
}
