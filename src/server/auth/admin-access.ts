import { isRole, type Role } from '@/domain/user'
import { decideRole } from '@/domain/access'

/**
 * Veredito PURO de acesso a uma seção do Console de admin (issues #63, #125). Mapeia o
 * `user` cru de `getSession` para uma decisão de apresentação, SEM reimplementar a regra de
 * papel — espelha o estilo de `decideRole` (sem DB, sem Better Auth, testável em unidade no
 * projeto node, que o jsdom não alcança).
 *
 * Por que existir: o gating já teve bug fail-OPEN histórico (#51) quando a lógica de
 * acesso ficou espalhada. Aqui o veredito REUSA `decideRole`/`isRole` do domínio (não
 * duplica o gate); o `layout.tsx` (min='curador') e cada `page.tsx` de seção (min='curador'
 * para Curadoria, min='admin' para Governança) só invocam e despacham. As rotas de API
 * AINDA reforçam o gate server-side com `requireRole` — esta UI é afordância, o servidor é
 * a verdade.
 *
 * Decisão de APRESENTAÇÃO consciente: o `requireRole` do servidor devolveria 401 (sem
 * papel) OU 403 (papel insuficiente); a UI funde "papel insuficiente" numa tela honesta de
 * acesso negado, e trata "sem sessão / conta desativada" como redirect ao login. Não é
 * falha de segurança — a verdade é reforçada em cada rota de API.
 *
 * FAIL-CLOSED: papel `null`/desconhecido (fora de `ROLES`) NUNCA passa — vira `denied`,
 * em qualquer mínimo. Um Curador batendo direto numa seção admin-only (min='admin') também
 * cai em `denied` — gate de rota, não só link escondido.
 */
type RawUser = { role?: string | null; deletedAt?: Date | string | null } | null | undefined

export type SectionAccess = 'redirect' | 'denied' | { role: 'curador' | 'admin' }

/** Compat #63: o tipo do veredito do Console, hoje o caso geral de `decideSectionAccess`. */
export type AdminAccess = SectionAccess

/**
 * Veredito por SEÇÃO/rota com mínimo explícito (#125). `min='curador'` é o gate do Console
 * (layout + Curadoria); `min='admin'` é a Governança (Config, Papéis). O `role` devolvido é
 * sempre >= 'curador' (garantido por o mínimo aceito nunca ser < curador).
 */
export function decideSectionAccess(user: RawUser, min: 'curador' | 'admin'): SectionAccess {
  // Sem sessão OU conta soft-deletada (deletedAt != null) = trate como anônimo → login.
  // Espelha o 401 do guard (requireSession barra deletedAt != null).
  if (!user || user.deletedAt != null) return 'redirect'

  // Normaliza o papel cru (string → Role|null via isRole). Papel fora de ROLES → null.
  const role: Role | null = typeof user.role === 'string' && isRole(user.role) ? user.role : null

  // Autenticado, mas papel < mínimo (cobre `usuario`, `null` e desconhecido) → fail-CLOSED.
  if (decideRole(role, min) !== 'allow') return 'denied'

  // `allow` para mínimo >= 'curador' garante que `role` é 'curador' ou 'admin'.
  return { role: role as 'curador' | 'admin' }
}

/** Veredito de acesso ao Console (#63): o caso `min='curador'` de `decideSectionAccess`. */
export function decideAdminAccess(user: RawUser): AdminAccess {
  return decideSectionAccess(user, 'curador')
}
