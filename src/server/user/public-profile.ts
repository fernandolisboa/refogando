import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { users } from '@/db/schema'
import { emailVerificationRequired } from '@/lib/auth'
import { publicAccountFilter } from '@/server/auth/pending-account'
import { listPublicRecipesByOwner } from '@/server/recipe/list-public'
import { buildPublicProfile, type PublicProfile } from '@/domain/recipe-profile-read'
import { validateLinks } from '@/domain/links'
import { normalizeHandle } from '@/domain/handle'
import {
  countFollowers,
  countFollowing,
  listFollowers,
  listFollowing,
  FOLLOW_LIST_PREVIEW,
} from '@/server/user/follow'

/**
 * Perfil PÚBLICO (#129) — loader de servidor COMPARTILHADO entre o `GET /api/u/[handle]` (route
 * fino) e a página `/{locale}/u/[handle]` (Server Component chama direto, sem self-fetch HTTP —
 * ADR-0010 segue: a UI não reimplementa domínio, reusa o MESMO loader da rota). ANÔNIMO (ADR-0011):
 * NUNCA lê sessão. Resolve o dono pelo handle, carrega o pool dele e delega a montagem ao módulo
 * PURO `buildPublicProfile`.
 *
 * `null` = 404 leak-safe: handle vazio/inexistente (ou conta soft-deletada — `deleted_at IS NULL` no
 * gate) — não vaza existência nem o privado de ninguém. O handle é normalizado (lower) antes da
 * consulta, espelhando a gravação no PATCH /api/me (#128).
 *
 * SEGURANÇA dos links: os links já foram validados http(s)-only na escrita (#127), mas
 * `validateLinks` é RE-aplicado aqui como defesa-em-profundidade (a UI os renderiza CLICÁVEIS)
 * — qualquer entrada que escape a validação histórica é saneada antes de sair no DTO.
 *
 * O DTO é JSON-puro (só string/number/boolean/null/arrays — sem `Date`): o que a página recebe direto
 * é o mesmo que o JSON da rota entregava.
 */
export async function loadPublicProfile(
  db: Database,
  rawHandle: string,
  requestLocale: string,
): Promise<PublicProfile | null> {
  // Normaliza como na gravação (#128): trim + lower. Handle vazio → 404 (sem tocar o DB útil).
  // Fonte ÚNICA (`normalizeHandle`) reusada pela rota de seguir (#274) — não divergir.
  const handle = normalizeHandle(rawHandle)
  if (handle === null) return null

  // Resolve o dono pelo handle. `deleted_at IS NULL` exclui contas soft-deletadas (não vaza
  // perfil de conta desativada). Só os campos PÚBLICOS — nunca email/role/id-na-resposta.
  const [owner] = await db
    .select({
      id: users.id,
      name: users.name,
      handle: users.handle,
      image: users.image,
      bio: users.bio,
      links: users.links,
    })
    .from(users)
    // #470: viva e, com a confirmação de email ligada, não PENDENTE (conta pendente não tem perfil público).
    .where(and(eq(users.handle, handle), publicAccountFilter(emailVerificationRequired())))
    .limit(1)
  if (!owner) return null

  // Bloco SOCIAL (#274): contadores + preview das listas. PÚBLICO e SEM estado do viewer — este loader
  // NUNCA lê a sessão (o "eu sigo?" é client-side, pra o perfil seguir anon-cacheável / Modelo B).
  // As seams gateiam soft-deleted; o `owner.id` é só interno (nunca emitido no DTO). DEGRADA: um erro
  // transitório no bloco social (assistivo) NÃO derruba o payload SEO-crítico (identidade + receitas)
  // — cai p/ social vazio (a view já omite listas vazias). `owner.id` nunca é emitido no DTO.
  const socialQuery = Promise.all([
    countFollowers(db, owner.id),
    countFollowing(db, owner.id),
    listFollowers(db, owner.id, FOLLOW_LIST_PREVIEW),
    listFollowing(db, owner.id, FOLLOW_LIST_PREVIEW),
  ])
    .then(([followerCount, followingCount, followers, following]) => ({
      followerCount,
      followingCount,
      followers,
      following,
    }))
    .catch(() => ({ followerCount: 0, followingCount: 0, followers: [], following: [] }))

  // Receitas PÚBLICAS (pool) do dono — privadas/playful/removidas NUNCA entram (list-public.ts). Só
  // dependem do `owner.id`, como o bloco social: as duas leituras correm juntas (o social nunca rejeita).
  const [recipeRows, social] = await Promise.all([listPublicRecipesByOwner(db, owner.id), socialQuery])

  // Defesa-em-profundidade (#127/#129): re-valida os links http(s)-only antes de emitir. Lista
  // inválida (não deveria ocorrer — a escrita já valida) ⇒ cai p/ vazia, nunca emite link inseguro.
  const linksCheck = validateLinks(owner.links)
  const links = linksCheck.ok ? linksCheck.links : []

  return buildPublicProfile({
    name: owner.name,
    handle: owner.handle,
    image: owner.image,
    bio: owner.bio,
    links,
    recipeRows,
    requestLocale,
    social,
  })
}
