/**
 * `sitemap.xml` (#235, ADR-0020) — gerado pelo Metadata File do Next (`app/sitemap.ts`). Casca FINA
 * de I/O: carrega as Receitas INDEXÁVEIS (gate empurrado pro SQL em `loadSitemapRecipes` = MESMO
 * `eligibleForPublicRead` do detalhe) e delega a montagem ao builder PURO `buildSitemapEntries`.
 *
 * URLs ABSOLUTAS via `getBaseUrlFromEnv` (env-only, sem `headers()`): a base vem da env do deploy
 * (Vercel) só conhecida em RUNTIME. Lê o DB DIRETO (sem self-fetch da API), ANÔNIMO (sem cookie/sessão)
 * — espelha o caminho indexável do detalhe.
 *
 * DINÂMICA (`force-dynamic`): renderiza sob demanda, NÃO no build. Duas razões — (1) lê o DB, que não
 * está disponível no build do CI; (2) `getBaseUrlFromEnv` LANÇA em produção sem `APP_URL`/`VERCEL_URL`,
 * e o smoke-check do CI (`next build`, NODE_ENV=production) não tem essas envs. Em runtime na Vercel a
 * env existe e a URL sai correta. (O detalhe já é dinâmico pelo ramo do dono — mesmo efeito.)
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

// Renderiza em runtime (não no build) — ver nota acima (DB + getBaseUrlFromEnv build-unsafe sem env).
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrlFromEnv()
  const recipes = await loadSitemapRecipes(getDb())
  return [...buildStaticLocaleEntries(baseUrl), ...buildSitemapEntries(recipes, baseUrl)]
}
