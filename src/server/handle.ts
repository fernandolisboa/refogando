import { eq, ne, and, like, or } from 'drizzle-orm'
import { getDb } from '@/server/deps'
import { users } from '@/db/schema'
import { disambiguate, handleBaseFromName } from '@/domain/handle'

/**
 * Borda I/O do handle (#128): casa a lógica PURA de `@/domain/handle` com o banco. Dois
 * usos — gerar um handle único na criação da conta (auth hook) e checar disponibilidade no
 * PATCH /api/me. A unicidade real exige consultar `users.handle`; a forma/reservadas ficam
 * no domínio puro.
 *
 * RACE: a UNIQUE `users_handle_uq` é a fonte da verdade final. Estas funções minimizam
 * colisão (consultam o estado atual), mas o INSERT/UPDATE ainda pode bater 23505 sob corrida
 * de signups simultâneos — o caller trata o erro de unicidade (gera-de-novo / 409).
 */

/** Escapa os curingas de LIKE (`%`, `_`, `\`) num literal de busca por prefixo. */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, '\\$&')
}

/**
 * Lê os handles JÁ EM USO que poderiam colidir com a desambiguação de `base`: o próprio
 * `base` e qualquer `base-<n>`. Busca por prefixo (`base` + `base-%`) em vez de varrer a
 * tabela toda. Só é usada na geração (criação de conta), onde não há dono a excluir.
 */
async function takenHandlesFor(base: string): Promise<Set<string>> {
  // O `base` puro e qualquer `base-<n>`: dois prefixos. `base` exato (não casa `base-%`) e
  // `base-%`. Uma única consulta por OR cobre os dois.
  const prefix = `${escapeLike(base)}-%`
  const rows = await getDb()
    .select({ handle: users.handle })
    .from(users)
    .where(or(eq(users.handle, base), like(users.handle, prefix)))
  return new Set(rows.map((r) => r.handle))
}

/**
 * Gera um handle ÚNICO derivado do nome, pronto pra gravar. Slugifica → fallback se preciso
 * → desambigua contra os handles em uso. Usado pelo auth hook na criação da conta.
 */
export async function generateUniqueHandle(name: string): Promise<string> {
  const base = handleBaseFromName(name)
  const taken = await takenHandlesFor(base)
  return disambiguate(base, taken)
}

/**
 * `true` se `handle` está LIVRE (nenhuma outra linha o usa). `excludeUserId` é o próprio dono
 * no PATCH (manter o handle atual não é colisão). NÃO valida formato/reservadas — só unicidade.
 */
export async function isHandleAvailable(handle: string, excludeUserId?: string): Promise<boolean> {
  const rows = excludeUserId
    ? await getDb()
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.handle, handle), ne(users.id, excludeUserId)))
        .limit(1)
    : await getDb().select({ id: users.id }).from(users).where(eq(users.handle, handle)).limit(1)
  return rows.length === 0
}
