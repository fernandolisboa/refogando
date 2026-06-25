/**
 * Busca de usuários (#269) — DTOs e lógica PURA (sem DB, sem I/O, NUNCA importa de `server/`). É a
 * fundação reusada pela busca pública de Cozinheiros (#279): o loader (`server/user/search`) é o
 * MESMO; admin e público diferem só por `includeEmail` (no loader) e pela PROJEÇÃO pura escolhida
 * na rota. Email é sensível — a allowlist de cada projeção é o que impede vazamento p/ o cliente.
 */
import type { Role } from '@/domain/user'
import { isUuid } from '@/domain/uuid'
import type { ProfileFollowUser } from '@/domain/recipe-profile-read'

export type UserQueryKind = 'id' | 'handle' | 'email' | 'text'
export type UserQuery = { kind: UserQueryKind; term: string }

/**
 * Teto de tamanho da query: nome/handle/email são curtos e UUID = 36. Acima disto é abuso (um `q`
 * gigante viraria `%<enorme>%` num seq scan, sem índice trigram ainda). O corte vive AQUI, no seam,
 * pra a rota admin E a futura busca pública de Cozinheiros (#279, sem auth) herdarem a proteção.
 */
export const MAX_USER_QUERY_LEN = 128

/**
 * Classifica o que foi digitado (PURO; NÃO consulta papel/includeEmail — a decisão de PERMITIR
 * busca por email é da CAMADA DE DADOS: o loader corta `kind:'email'` quando `!includeEmail`). A
 * ORDEM importa:
 *  1. `trim`; vazio OU acima do teto → null (sem ida ao banco).
 *  2. forma de UUID → `id` (match exato).
 *  3. começa com `@` → `handle` (sem o `@`); `@` sozinho → null.
 *  4. contém `@` (não no início) → `email`.
 *  5. senão → `text` (nome OU handle).
 */
export function classifyUserQuery(raw: string): UserQuery | null {
  const q = raw.trim()
  if (q.length === 0 || q.length > MAX_USER_QUERY_LEN) return null
  if (isUuid(q)) return { kind: 'id', term: q }
  if (q.startsWith('@')) {
    const term = q.slice(1)
    return term.length === 0 ? null : { kind: 'handle', term }
  }
  if (q.includes('@')) return { kind: 'email', term: q }
  return { kind: 'text', term: q }
}

/**
 * Linha CRUA do loader. `email` SÓ existe quando o loader buscou como admin (`includeEmail`) — no
 * caminho público a coluna NEM É SELECIONADA, então a chave nem aparece em runtime (provado por
 * `'email' in row === false` no teste de integração). O gate é de RUNTIME+TESTE, não do tipo: como
 * `email` é opcional, o TS não impede uma projeção #279 de ler `row.email` — a defesa é o loader não
 * selecionar a coluna. (Se quiser garantia de compilação no #279, modelar como união discriminada.)
 */
export type UserSearchRow = {
  id: string
  name: string
  handle: string
  image: string | null
  role: Role
  email?: string
}

/**
 * DTO do resultado p/ o contexto ADMIN (Papéis): inclui `role` (a UI mostra o papel atual) e
 * `email` (admin enxerga, p/ desambiguar). Allowlist EXPLÍCITA — nunca devolve a linha crua (sem
 * `deletedAt`/`banReason`/etc.).
 */
export type AdminUserResult = {
  id: string
  name: string
  handle: string
  image: string | null
  role: Role
  email: string | null
}

/** Projeção PURA admin (allowlist). Hoje a linha admin sempre traz `email` (coluna NOT NULL e
 * sempre selecionada), então o `?? null` é seguro forward-looking — blinda a reutilização da linha
 * pela futura projeção pública (#279), não um caso atual. */
export function projectAdminUserResult(row: UserSearchRow): AdminUserResult {
  return {
    id: row.id,
    name: row.name,
    handle: row.handle,
    image: row.image,
    role: row.role,
    email: row.email ?? null,
  }
}

/**
 * Projeção PÚBLICA de Cozinheiro (#279, cluster da Busca mesclada) — a allowlist MÍNIMA: SÓ
 * nome/@handle/avatar. Dropa `id` (o uuid interno NUNCA vai pro cliente), `role` (Cozinheiro é LENTE,
 * não papel) e `email` (PII — já nem é selecionada no caminho público). Reusa o tipo `ProfileFollowUser`
 * (mesma forma pública usada nas listas de seguidores #274 — sem terceiro DTO quase-idêntico). A
 * PROJEÇÃO é o gate de DADOS pro cliente; a rota NUNCA devolve a linha crua.
 */
export function projectPublicCook(row: UserSearchRow): ProfileFollowUser {
  return { name: row.name, handle: row.handle, image: row.image }
}
