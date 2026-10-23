import { createHmac } from 'node:crypto'
import { and, ne, sql } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'

/**
 * Onde mora o avatar de cada conta no `ImageStore` e quando o servidor pode apagá-lo (#604).
 *
 * `store.owns` só confere o HOST (é do nosso Vercel Blob?), não de QUEM é o arquivo. Enquanto o Better Auth
 * aceitava `image` em `/update-user` e `/sign-up/email`, qualquer conta podia gravar em `users.image` a URL de um
 * blob alheio (avatar, foto de avaliação, foto de receita) e depois apagá-lo trocando/removendo o avatar ou
 * eliminando a conta. O hook `before` de `src/lib/auth.ts` fecha a entrada; esta é a segunda barreira, no ponto
 * em que se apaga:
 *
 * - Desde #604 o avatar é guardado sob `avatars/<chave da conta>/` (`avatarPathPrefix`). A chave é um HMAC do id
 *   com o segredo do Better Auth, NÃO o id: a URL do avatar é pública (perfil, busca, listas) e o id cru ligaria a
 *   pessoa às Receitas que ficam com o handle `removido-<id>` depois da eliminação.
 * - Avatar que não traz a chave desta conta não diz de quem é: o ANTIGO (`avatars/<arquivo>`, antes de #604) e o
 *   de outra chave (o segredo foi trocado depois do upload). Só é apagado se nenhuma OUTRA conta aponta para o
 *   mesmo CAMINHO, em qualquer host (quem plantou a URL alheia não apaga o avatar de quem ainda o usa, nem com a
 *   URL de outro store do Vercel). Assim a troca do segredo não deixa o avatar vivo depois da eliminação.
 * - A URL precisa estar na forma CANÔNICA que o store grava (sem query, hash, porta, credenciais nem `%`): uma
 *   variante plantada antes de #604 (`…/avatars/x.webp?1`) driblaria a comparação exata do banco e apagaria o blob
 *   canônico de outra pessoa.
 * - Qualquer outro caminho (`recipes/`, `reviews/`, a chave de outra conta) e URL estrangeira (Google OAuth) nunca
 *   são apagados por aqui.
 */

/** Nome de arquivo que o store grava (uuid, ou o contador do dublê) + extensão de imagem. */
const FILE = '[A-Za-z0-9-]+\\.(?:webp|jpg|png)'
const LEGACY_AVATAR_PATH = new RegExp(`^/avatars/${FILE}$`)
const KEYED_AVATAR_PATH = new RegExp(`^/avatars/[A-Za-z0-9_-]{22}/${FILE}$`)

function avatarSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (secret) return secret
  // Mesma regra do `src/lib/auth.ts`: só o teste roda sem segredo.
  if (process.env.NODE_ENV === 'test') return 'refogando-test-avatar-secret'
  throw new Error('BETTER_AUTH_SECRET obrigatório (fora de teste)')
}

/** Chave opaca e estável da conta no caminho do avatar (22 caracteres base64url, 132 bits do HMAC). */
function avatarAccountKey(userId: string): string {
  return createHmac('sha256', avatarSecret()).update(`avatar:${userId}`).digest('base64url').slice(0, 22)
}

/** Prefixo do blob de avatar de uma conta (`pathPrefix` do `ImageStore`). */
export function avatarPathPrefix(userId: string): string {
  return `avatars/${avatarAccountKey(userId)}`
}

/** Caminho da URL se ela estiver na forma canônica que o store grava; senão null. */
function canonicalPath(url: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.href !== url || u.search || u.hash || u.port || u.username || u.password) return null
  if (u.pathname.includes('%')) return null
  return u.pathname
}

/**
 * Em que forma `url` é um avatar para a conta: `conta` (prefixo dela), `sem-dono` (avatar antigo ou de outra
 * chave: só o banco diz se outra conta o usa) ou null (não é avatar apagável). Devolve também o caminho.
 */
export function avatarPathKind(url: string, userId: string): { kind: 'conta' | 'sem-dono'; path: string } | null {
  const path = canonicalPath(url)
  if (path === null) return null
  const prefix = `/${avatarPathPrefix(userId)}/`
  if (path.startsWith(prefix) && new RegExp(`^${FILE}$`).test(path.slice(prefix.length))) return { kind: 'conta', path }
  if (LEGACY_AVATAR_PATH.test(path) || KEYED_AVATAR_PATH.test(path)) return { kind: 'sem-dono', path }
  return null
}

/**
 * O servidor pode apagar `url`, o avatar que a conta `userId` acabou de largar? Exige que o blob seja NOSSO
 * (`store.owns`), canônico e da conta (prefixo dela, ou avatar sem dono conhecido que nenhuma outra conta usa). Nunca lança:
 * na dúvida, não apaga (um órfão é tolerável; apagar o arquivo de outra pessoa, não).
 */
export async function canDeleteAccountAvatar(
  db: Database,
  store: ImageStore,
  url: string | null | undefined,
  userId: string,
): Promise<boolean> {
  try {
    if (!url || !store.owns(url)) return false
    const found = avatarPathKind(url, userId)
    if (found === null) return false
    if (found.kind === 'conta') return true
    // Pelo CAMINHO, não pela URL inteira: outro host do Vercel com o mesmo caminho não dribla a checagem. O caminho
    // só tem `[A-Za-z0-9_./-]` (regex acima), então não há curinga do LIKE a escapar.
    const [other] = await db
      .select({ one: sql<number>`1` })
      .from(users)
      .where(and(sql`${users.image} like ${'%' + found.path}`, ne(users.id, userId)))
      .limit(1)
    return other === undefined
  } catch {
    return false
  }
}
