/**
 * `sitemap.xml` (#235, ADR-0020) — gerado pelo Metadata File do Next (`app/sitemap.ts`). Casca FINA
 * de I/O: carrega as Receitas INDEXÁVEIS (gate empurrado pro SQL em `loadSitemapRecipes` = MESMO
 * `eligibleForPublicRead` do detalhe) e delega a montagem ao builder PURO `buildSitemapEntries`.
 *
 * URLs ABSOLUTAS via `getBaseUrlFromEnv` (env-only, sem `headers()`) — BUILD-SAFE: o sitemap pode ser
 * avaliado em build/estaticamente; tocar `headers()` o forçaria a dinâmico e quebraria a derivação do
 * host. Lê o DB DIRETO (sem self-fetch da API), ANÔNIMO (sem cookie/sessão) — espelha o caminho
 * indexável do detalhe.
 *
 * Conteúdo: as homes por locale (`buildStaticLocaleEntries`) + uma entrada por (receita indexável,
 * locale com slug), cada uma com hreflang (`alternates.languages`, incl. x-default). O Next serializa
 * o hreflang como `<xhtml:link rel="alternate">` no XML.
 */
import type { MetadataRoute } from 'next'
import { getBaseUrlFromEnv } from '@/server/http/base-url'
import { getDb } from '@/server/deps'
import { loadSitemapRecipes } from '@/server/recipe/sitemap'
import { buildSitemapEntries, buildStaticLocaleEntries } from '@/domain/sitemap'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrlFromEnv()
  const recipes = await loadSitemapRecipes(getDb())
  return [...buildStaticLocaleEntries(baseUrl), ...buildSitemapEntries(recipes, baseUrl)]
}
