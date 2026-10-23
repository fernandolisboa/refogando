import { getAuth } from '@/lib/auth'
import { isRole, type Role } from '@/domain/user'
import { DEFAULT_PLAN, isPlan, type Plan } from '@/domain/plan'
import { decideRole } from '@/domain/access'
import { isFreshSession } from '@/domain/fresh-session'

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
// Os handlers só importam as funções `require*` (`requireSession`, `requireSessionFromHeaders`, `requireRole`,
// `requireFreshSession`, `requireFreshRole`), nunca esses tipos.
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

/** Recusa no formato de sempre: corpo `{ error: '<chave>' }` com o status dado. */
function deny(status: 401 | 403, error: string): GuardFail {
  return { ok: false, response: Response.json({ error }, { status }) }
}

/**
 * Papel abaixo do mínimo ⇒ 403 `papel_insuficiente`; senão `null`. FAIL-CLOSED (#51): só `allow` passa. Um papel
 * `null`/desconhecido de usuário AUTENTICADO faz `decideRole` devolver `unauthenticated`/`forbidden`, e QUALQUER
 * coisa que não seja `allow` vira 403. (Barrar só em `forbidden` era fail-OPEN: `null` → `unauthenticated` passava.)
 */
function roleDenial(session: Session, min: Role): GuardFail | null {
  return decideRole(session.user.role, min) === 'allow' ? null : deny(403, 'papel_insuficiente')
}

/** #602 — sessão criada há mais de `FRESH_SESSION_MAX_AGE_MS` ⇒ 403 `reautenticar`; senão `null`. */
function staleSessionDenial(createdAt: Date | string | null, now: Date): GuardFail | null {
  return isFreshSession(createdAt, now) ? null : deny(403, 'reautenticar')
}

/** 401 se sem sessão ou conta soft-deletada (D4). */
export async function requireSession(req: Request): Promise<GuardResult> {
  return requireSessionFromHeaders(req.headers)
}

/**
 * Mesma regra de `requireSession`, a partir dos HEADERS crus — para Server Components, que não têm
 * `Request` (passam `await headers()` de `next/headers`). Fonte única: `requireSession` delega aqui.
 */
export async function requireSessionFromHeaders(headers: Headers): Promise<GuardResult> {
  return (await resolveSession(headers)).result
}

/** O guard de `requireSession` + quando a sessão foi CRIADA (para as variantes `requireFresh*`). */
async function resolveSession(headers: Headers): Promise<{ result: GuardResult; createdAt: Date | string | null }> {
  const raw = await getAuth().api.getSession({ headers })
  const user = raw?.user as RawSessionUser | undefined
  if (!user) return { result: deny(401, 'nao_autenticado'), createdAt: null }
  // E5 — soft-delete sem seam: a sessão é válida, mas a conta foi desativada (deletedAt
  // != null). Barramos com 401 conta_desativada. cookieCache fica OFF (senão ficaria stale).
  if (user.deletedAt != null) return { result: deny(401, 'conta_desativada'), createdAt: null }
  const createdAt = (raw?.session as { createdAt?: Date | string } | undefined)?.createdAt ?? null
  return { result: { ok: true, session: toSession(user) }, createdAt }
}

/**
 * #602 — `requireSession` + sessão RECENTE (criada há menos de `FRESH_SESSION_MAX_AGE_MS`, `domain/fresh-session`)
 * para ação destrutiva, como excluir a conta. Sessão antiga ⇒ 403 `reautenticar` (a pessoa entra de novo e volta).
 * A idade conta da CRIAÇÃO: a renovação diária do Better Auth (`updateAge`) mexe só em `expiresAt`.
 */
export async function requireFreshSession(req: Request, now: Date = new Date()): Promise<GuardResult> {
  const { result, createdAt } = await resolveSession(req.headers)
  if (!result.ok) return result
  return staleSessionDenial(createdAt, now) ?? result
}

/** 401 sem sessão / conta desativada; 403 se papel < mínimo (fail-closed, E11). */
export async function requireRole(req: Request, min: Role): Promise<GuardResult> {
  const r = await requireSession(req)
  if (!r.ok) return r
  return roleDenial(r.session, min) ?? r
}

/**
 * #606 — `requireRole` + sessão RECENTE (`requireFreshSession`), para a ação destrutiva da equipe (eliminar a conta de
 * outra pessoa pelo Console). O papel vem antes: quem não é admin recebe o 403 `papel_insuficiente` de sempre, nunca
 * o convite para entrar de novo. Admin com sessão antiga ⇒ 403 `reautenticar`.
 */
export async function requireFreshRole(req: Request, min: Role, now: Date = new Date()): Promise<GuardResult> {
  const { result, createdAt } = await resolveSession(req.headers)
  if (!result.ok) return result
  return roleDenial(result.session, min) ?? staleSessionDenial(createdAt, now) ?? result
}
