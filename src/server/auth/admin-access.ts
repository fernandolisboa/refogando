import { isRole, type Role } from '@/domain/user'
import { decideRole } from '@/domain/access'

/**
 * Veredito PURO de acesso ao Console de admin (issue #63). Mapeia o `user` cru de
 * `getSession` para uma decisão de apresentação, SEM reimplementar a regra de papel —
 * espelha o estilo de `decideRole` (sem DB, sem Better Auth, testável em unidade no
 * projeto node, que o jsdom não alcança).
 *
 * Por que existir: o gating já teve bug fail-OPEN histórico (#51) quando a lógica de
 * acesso ficou espalhada. Aqui o veredito REUSA `decideRole`/`isRole` do domínio (não
 * duplica o gate); o `page.tsx` só invoca e despacha. Cada seção do console AINDA reforça
 * o gate server-side no seu próprio fetch — esta UI é afordância, o servidor é a verdade.
 *
 * Decisão de APRESENTAÇÃO consciente: o `requireRole` do servidor devolveria 401 (sem
 * papel) OU 403 (papel insuficiente); a UI funde "papel insuficiente" numa tela honesta de
 * acesso negado, e trata "sem sessão / conta desativada" como redirect ao login. Não é
 * falha de segurança — a verdade é reforçada em cada rota.
 *
 * FAIL-CLOSED: papel `null`/desconhecido (fora de `ROLES`) NUNCA passa — vira `denied`.
 */
type RawUser = { role?: string | null; deletedAt?: Date | string | null } | null | undefined

export type AdminAccess = 'redirect' | 'denied' | { role: 'curador' | 'admin' }

export function decideAdminAccess(user: RawUser): AdminAccess {
  // Sem sessão OU conta soft-deletada (deletedAt != null) = trate como anônimo → login.
  // Espelha o 401 do guard (requireSession barra deletedAt != null).
  if (!user || user.deletedAt != null) return 'redirect'

  // Normaliza o papel cru (string → Role|null via isRole). Papel fora de ROLES → null.
  const role: Role | null = typeof user.role === 'string' && isRole(user.role) ? user.role : null

  // Autenticado, mas papel < Curador (cobre `usuario`, `null` e desconhecido) → fail-CLOSED.
  if (decideRole(role, 'curador') !== 'allow') return 'denied'

  // `allow` para mínimo 'curador' garante que `role` é 'curador' ou 'admin'.
  return { role: role as 'curador' | 'admin' }
}
