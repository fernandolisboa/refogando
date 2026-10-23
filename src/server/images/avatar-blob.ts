import { and, eq, ne, sql } from 'drizzle-orm'
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
 * - Desde #604 o avatar é guardado sob `avatars/<userId>/` (`avatarPathPrefix`). Um blob nesse prefixo é da conta.
 * - Avatar ANTIGO (`avatars/<arquivo>`, um segmento só, antes de #604) não diz de quem é: só é apagado se
 *   nenhuma OUTRA conta aponta para a mesma URL (quem plantou a URL alheia não apaga o avatar de quem ainda o usa).
 * - Qualquer outro caminho (`recipes/`, `reviews/`, `avatars/<outra conta>/…`) e URL estrangeira (Google OAuth)
 *   nunca são apagados por aqui.
 */

/** Prefixo do blob de avatar de uma conta (`pathPrefix` do `ImageStore`). */
export function avatarPathPrefix(userId: string): string {
  return `avatars/${userId}`
}

/** Caminho (pathname) da URL, ou null se a string não for URL. */
function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/** A URL é de um avatar gravado pelo servidor para ESTA conta (`avatars/<userId>/<arquivo>`)? */
export function isAccountAvatarPath(url: string, userId: string): boolean {
  const path = pathnameOf(url)
  if (path === null) return false
  const prefix = `/${avatarPathPrefix(userId)}/`
  return path.startsWith(prefix) && path.length > prefix.length && !path.slice(prefix.length).includes('/')
}

/** Avatar do formato anterior a #604 (`avatars/<arquivo>`, sem a conta no caminho)? */
function isLegacyAvatarPath(url: string): boolean {
  const path = pathnameOf(url)
  return path !== null && /^\/avatars\/[^/]+$/.test(path)
}

/**
 * O servidor pode apagar `url`, o avatar que a conta `userId` acabou de largar? Exige que o blob seja NOSSO
 * (`store.owns`) e da conta (prefixo da conta, ou avatar antigo que nenhuma outra conta usa). Nunca lança: na
 * dúvida, não apaga (um órfão é tolerável; apagar o arquivo de outra pessoa, não).
 */
export async function canDeleteAccountAvatar(
  db: Database,
  store: ImageStore,
  url: string | null | undefined,
  userId: string,
): Promise<boolean> {
  try {
    if (!url || !store.owns(url)) return false
    if (isAccountAvatarPath(url, userId)) return true
    if (!isLegacyAvatarPath(url)) return false
    const [other] = await db
      .select({ one: sql<number>`1` })
      .from(users)
      .where(and(eq(users.image, url), ne(users.id, userId)))
      .limit(1)
    return other === undefined
  } catch {
    return false
  }
}
