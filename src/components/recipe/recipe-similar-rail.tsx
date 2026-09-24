/**
 * Trilho "Receitas semelhantes" (#454) — 3-4 cards por similaridade de cosseno via
 * `recipe_embedding` (pgvector, já existe — zero custo de IA nesta leitura). Server-rendered,
 * cacheável: reusa `RecipeResultItem` (o MESMO card do feed/busca — nunca duplica o item), sem
 * hooks/fetch próprios. Componente PURO, sem `'use client'`.
 *
 * "Ausente ≠ vazio" (mesmo princípio do resto do app): `results` vazio (sem embedding próprio, ou
 * nenhum vizinho elegível acima do piso de similaridade) ⇒ retorna `null`, sem heading órfão.
 *
 * INEGOCIÁVEL: o loader (`@/server/recipe/similar`) já filtra pelos MESMOS gates de
 * `eligibleForPool` — este componente só RENDERIZA o que chega, não re-filtra nem re-deriva
 * elegibilidade (a UI nunca reimplementa gate de domínio).
 */
import { RecipeResultItem, type BadgeLabels } from './recipe-result-item'
import type { SearchResult } from '@/domain/recipe-search-read'
import type { Messages } from '@/i18n/messages'

export function RecipeSimilarRail({
  results,
  locale,
  m,
}: {
  results: SearchResult[]
  locale: string
  m: Messages
}) {
  if (results.length === 0) return null

  const busca = m.busca
  const badgeLabels: BadgeLabels = { catalogo: busca.seloCatalogo, comunidade: busca.seloComunidade }

  return (
    <section aria-labelledby="receitas-semelhantes-label" className="flex flex-col gap-3">
      <h2 id="receitas-semelhantes-label" className="font-display text-xl font-semibold text-fg">
        {m.detalhe.receitasSemelhantes}
      </h2>
      <ul role="list" className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {results.map((r) => (
          <RecipeResultItem
            key={r.recipeId}
            recipeId={r.recipeId}
            locale={locale}
            slug={r.slug}
            displayedTitle={r.displayedTitle}
            origin={r.origin}
            autoTranslationSignal={r.autoTranslationSignal}
            badgeLabels={badgeLabels}
            autoTranslationLabel={busca.traducaoAutomatica}
            author={r.author}
            byLabel={busca.porAutor}
            imageUrl={r.imageUrl}
            imageAiGenerated={r.imageAiGenerated}
            aiLabel={busca.imagemSeloIa}
            layout="grid"
          />
        ))}
      </ul>
    </section>
  )
}
