/**
 * Perfil PÚBLICO (#129) — DTOs e montagem PURA da página `/u/<handle>`. Sem DB, sem I/O: recebe
 * as linhas já carregadas (a identidade pública do dono + as Receitas PÚBLICAS dele, com as
 * traduções) e projeta o `PublicProfile` que a rota serializa.
 *
 * LEAK-SAFETY: o perfil é ANÔNIMO-readable e expõe SÓ o que é público — `name`/`handle`/`image`/
 * `bio`/`links` do dono e, por receita, o `displayedTitle` + `origin` + a foto de capa (`imageUrl`,
 * só o `blob_url` PÚBLICO, nunca o `image_id` interno) + `imageAiGenerated` (#130/#132) — os campos do
 * `RecipeResultItem` já públicos. NUNCA o `email`/`id`/papel do dono, nem `visibility`/
 * `resultKind` das receitas (campos de gestão são owner-gated em #59 — aqui o gate de POOL já
 * garante que só públicas chegam, então a visibilidade é redundante e não é exposta).
 *
 * Reusa `resolveName` (#3) p/ o título exibido (original primário + tradução confiável entre
 * parênteses) — NÃO re-deriva a regra. Espelha `resolveRecipeListItem` (#61), mas SEM os campos
 * de gestão (a lista do dono os expõe; o perfil público não).
 */
import type { Origin } from '@/domain/recipe'
import type { ProfileLink } from '@/domain/links'
import { resolveName, type TranslationRow } from '@/domain/recipe-read'

/**
 * Linha de Receita pública do perfil (o loader a projeta): a espinha mínima para o título +
 * proveniência, mais as traduções (original/pedida) que `resolveName` consome. NÃO carrega
 * `visibility`/`resultKind` (gate de pool já filtrou — só públicas chegam).
 */
export type ProfileRecipeRow = {
  id: string
  origin: Origin
  originalLocale: string
  // Slugs por idioma (#231, ADR-0020): `{ locale → slug }` SÓ dos locales com slug não-NULL (o loader
  // o projeta). O builder pega o slug do `requestLocale` (locale corrente) pra montar o link canônico
  // `/{locale}/recipes/<slug>`; ausente naquele locale ⇒ o card cai no fallback por UUID. O loader é
  // locale-agnóstico (não sabe o requestLocale) — quem escolhe é o `requestLocale` do builder.
  slugByLocale?: Record<string, string>
  // Foto de capa (#130/#132) — CRUS do LEFT JOIN em recipe_image (via recipe.image_id, gate
  // moderated_at IS NULL no loader). Nullable (sem imagem / imagem moderada ⇒ NULL). O projetor deriva
  // `imageUrl`/`imageAiGenerated` aqui (não no loader), espelhando `projectResult` da Busca.
  imageUrl?: string | null
  imageProvenance?: string | null
  translations: ReadonlyArray<TranslationRow>
}

/** Um item de receita no perfil público — o mínimo que `RecipeResultItem` consome. */
export type ProfileRecipeItem = {
  recipeId: string
  displayedTitle: string
  origin: Origin
  // Slug do locale CORRENTE (#231) — pro card linkar `/{locale}/recipes/<slug>`. AUSENTE ("ausente ≠
  // vazio") quando não há slug naquele locale: o card cai no fallback canônico por UUID.
  slug?: string
  // Foto de capa (#130) — `blob_url` PÚBLICO da thumbnail. AUSENTE ("ausente ≠ vazio") quando a Receita
  // não tem imagem ⇒ o card cai no placeholder. Espelha `SearchResult.imageUrl`; nunca o `image_id`.
  imageUrl?: string
  // Imagem gerada por IA (#132)? Dirige o selo "✨ gerada por IA" no card. AUSENTE quando não/foto.
  imageAiGenerated?: boolean
}

/** Um Cozinheiro numa lista pública de seguir (#274) — allowlist mínima (nome/@handle/avatar). */
export type ProfileFollowUser = {
  name: string
  handle: string
  image: string | null
}

/**
 * Bloco SOCIAL público do perfil (#274, ADR-0024): contadores (derivados por query no v1) + um
 * PREVIEW capado das listas de Seguidores/Seguindo. Tudo PÚBLICO e SEM estado do viewer (o "eu
 * sigo?" é resolvido client-side pela ilha, pra o perfil seguir anon-cacheável — Modelo B/ADR-0020).
 * Os contadores são o total VIVO; as listas são só os primeiros N (mais recentes).
 */
export type ProfileSocial = {
  followerCount: number
  followingCount: number
  followers: ProfileFollowUser[]
  following: ProfileFollowUser[]
}

/**
 * O perfil público completo (#129): a identidade pública do dono + as Receitas públicas dele + o
 * bloco social (#274). `image`/`bio` são NULLABLE (perfil sem avatar/bio é normal). `links` é sempre
 * array (default `[]` no banco). `recipes` já vem ordenado (mais novas primeiro) e projetado.
 */
export type PublicProfile = {
  name: string
  handle: string
  image: string | null
  bio: string | null
  links: ProfileLink[]
  recipes: ProfileRecipeItem[]
  social: ProfileSocial
}

/**
 * Projeta UMA linha de Receita do perfil para `ProfileRecipeItem`. PURO/total: nunca lança.
 * Devolve `null` quando não há título exibível (sem tradução — defesa "nunca tela quebrada",
 * espelha `projectResult`): a rota o PULA, nunca empurra um card de título em branco.
 */
export function projectProfileRecipe(
  row: ProfileRecipeRow,
  requestLocale: string,
): ProfileRecipeItem | null {
  if (row.translations.length === 0) return null
  const displayedTitle = resolveName({
    originalLocale: row.originalLocale,
    requestLocale,
    translations: row.translations,
  })
  if (displayedTitle.length === 0) return null
  // #231: slug do locale CORRENTE pro link canônico. "ausente ≠ vazio": só quando o locale pedido tem
  // slug (o builder/loader é locale-agnóstico — a escolha é por `requestLocale` aqui).
  const slug = row.slugByLocale?.[requestLocale]
  return {
    recipeId: row.id,
    displayedTitle,
    origin: row.origin,
    ...(slug != null ? { slug } : {}),
    // #130/Imagem: foto de capa PÚBLICA. "ausente ≠ vazio": só quando há blob (imageUrl != null —
    // o LEFT JOIN traz NULL sem imagem ou com imagem moderada). Espelha `projectResult` da Busca.
    ...(row.imageUrl != null ? { imageUrl: row.imageUrl } : {}),
    // #132/selo: imagem gerada por IA? "ausente ≠ vazio": só quando ai_generated (foto do dono NÃO).
    ...(row.imageProvenance === 'ai_generated' ? { imageAiGenerated: true } : {}),
  }
}

/**
 * Monta o `PublicProfile` a partir da identidade do dono + as linhas de receita já carregadas.
 * Projeta cada receita (pulando as sem título exibível). PURO.
 */
export function buildPublicProfile(input: {
  name: string
  handle: string
  image: string | null
  bio: string | null
  links: ProfileLink[]
  recipeRows: ReadonlyArray<ProfileRecipeRow>
  requestLocale: string
  social: ProfileSocial
}): PublicProfile {
  const recipes: ProfileRecipeItem[] = []
  for (const row of input.recipeRows) {
    const item = projectProfileRecipe(row, input.requestLocale)
    if (item !== null) recipes.push(item)
  }
  return {
    name: input.name,
    handle: input.handle,
    image: input.image,
    bio: input.bio,
    links: input.links,
    recipes,
    social: input.social,
  }
}
