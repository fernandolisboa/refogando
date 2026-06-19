/**
 * Página /recipes (#98) — browse/catálogo. Server component FINO: monta o
 * `<RecipeBrowseExperience />` (client, que provê o ÚNICO `<main>` do documento via
 * `<Container as="main">`). Espelha `app/page.tsx` (a home #56, que monta
 * `<SearchExperience />`). URL em inglês (CONTEXT.md). Distinta da home: aqui é
 * browse-first (lista o pool sem digitar nada); lá é busca-first.
 */
import { RecipeBrowseExperience } from '@/components/recipe/recipe-browse-experience'

export default function RecipesPage() {
  return <RecipeBrowseExperience />
}
