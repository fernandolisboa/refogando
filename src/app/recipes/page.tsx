/**
 * Página /recipes (#103) — FEED. Server component FINO: monta o `<RecipeFeedExperience />`
 * (client, que provê o ÚNICO `<main>` do documento via `<Container as="main">`). Espelha
 * `app/page.tsx` (a home #56). URL em inglês (CONTEXT.md). Distinta da home: aqui é um feed
 * cronológico do pool com scroll infinito, SEM busca nem filtros; lá é busca-first.
 */
import { RecipeFeedExperience } from '@/components/recipe/recipe-feed-experience'

export default function RecipesPage() {
  return <RecipeFeedExperience />
}
