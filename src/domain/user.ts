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

/**
 * Teto numérico de um papel numa tabela de cota EM CÓDIGO (`Record<Role, number | null>`: Sugestão de
 * cardápio ADR-0036, Derivar/Clonar #588). Papel desconhecido/ausente ⇒ o de `usuario` (fail-closed;
 * `Object.hasOwn` pra uma chave herdada como `toString` não passar por papel). `null` ⇒ `Infinity`
 * (ilimitado: os gates de cota pulam lock e recontagem).
 */
export function capFromRoleTable(table: Record<Role, number | null>, role: Role | null | undefined): number {
  const raw = role != null && Object.hasOwn(table, role) ? table[role] : table.usuario
  return raw == null ? Infinity : raw
}
