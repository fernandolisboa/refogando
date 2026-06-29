import { resolveRecipeView, type RecipeView, type GalleryImage } from '@/domain/recipe-read'
import type { Database } from '@/db/client'
import { loadRecipeRows } from '@/server/recipe/load'
import { loadGallery } from '@/server/recipe/image'

/**
 * Leitura CURADOR-aware de uma Receita de CATÁLOGO (#238, ADR-0026 emenda dec.9/10): o `RecipeView`
 * (conteúdo p/ pré-preencher o editor reusado) + a galeria da linhagem (p/ o estúdio de imagem do
 * curador). A galeria vem como campo IRMÃO top-level — NÃO dentro da view.
 */
export type CatalogCuratorView = { view: RecipeView; gallery: GalleryImage[] }

/**
 * Por que NÃO reusa o `buildView` do dono: `resolveRecipeView` só emite `gallery`/`visibility`/
 * `resultKind` DENTRO do bloco `canManage` (owner-estrito) — catálogo (`owner_id IS NULL`) NUNCA
 * passa, então a view voltaria sem galeria (achado HIGH do plan-review). O conteúdo
 * (name/body/facets/porcoes/dificuldade/tempos/ingredients) popula INCONDICIONALMENTE. Então montamos
 * a view com `viewerId: undefined` (⇒ `canManage` false ⇒ visibility/resultKind/gallery OMITIDOS da
 * view, fail-safe) e ANEXAMOS a galeria autorizada como sibling — autorização é da BORDA (a rota
 * gateia `requireRole('curador')` + `origin='catalog'`). **NUNCA** afrouxa o resolver público (é o
 * único caminho de leitura pública; um bypass de manage vazaria gallery/visibility de catálogo a anon).
 *
 * Defense-in-depth: exige `origin='catalog'` E `owner_id IS NULL` (não afrouxa p/ um só) — devolve
 * null (a rota mapeia 404 leak-safe) p/ qualquer outra coisa. NUNCA expõe `owner_id`/id interno
 * (o `RecipeView` não os carrega; só o `id` da receita, que o curador já tem na fila).
 */
export async function loadCatalogCuratorView(
  db: Database,
  id: string,
  requestLocale: string,
): Promise<CatalogCuratorView | null> {
  const rows = await loadRecipeRows(db, id)
  if (!rows || rows.recipe.origin !== 'catalog' || rows.recipe.ownerId != null) return null
  const view = resolveRecipeView({ ...rows, requestLocale, viewerId: undefined })
  // `lineage_id` é NOT NULL no banco; o `?? ''` só satisfaz o tipo opcional do RecipeRow puro.
  const gallery = await loadGallery(db, rows.recipe.lineageId ?? '', rows.recipe.imageId ?? null)
  return { view, gallery }
}
