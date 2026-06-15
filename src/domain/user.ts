/**
 * Papéis de Usuário — kernel de domínio (issue #5, ADR-0011).
 *
 * Mesma forma de `recipe.ts`/`vocabulary.ts`: array `as const` + tipo derivado +
 * guard puro. NÃO inclui `visitante`: Visitante = ausência de sessão/conta (ADR-0011),
 * não um valor de papel persistido. `schema.ts` mapeia este array para `pgEnum('role')`.
 */
export const ROLES = ['usuario', 'curador', 'admin'] as const
export type Role = (typeof ROLES)[number]

export function isRole(v: string): v is Role {
  return (ROLES as readonly string[]).includes(v)
}

/** Papel default de conta nova (ADR-0011: Usuário é a conta padrão). */
export const DEFAULT_ROLE: Role = 'usuario'

/**
 * Ordem de privilégio para gating hierárquico. Curador ⊇ Usuário; Admin ⊇ Curador.
 * Usada por `requireRole` para "papel >= mínimo".
 */
export const ROLE_RANK: Record<Role, number> = { usuario: 0, curador: 1, admin: 2 }
