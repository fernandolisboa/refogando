/**
 * Builder PURO do sitemap (#235, ADR-0020) — sem DB, sem React, sem `next/*` além do TIPO
 * `MetadataRoute.Sitemap`. Recebe as Receitas elegíveis (JÁ gateadas pela query server — gate de
 * indexação default-open: comunidade/Catálogo E não-`playful` E não-removida) com seus slugs POR
 * locale + um `lastModified`, MAIS a `baseUrl` BUILD-SAFE (env-only, NUNCA derivada de `headers()`,
 * senão o sitemap viraria dinâmico — ADR-0020), e devolve as entradas do `MetadataRoute.Sitemap`.
 *
 * REGRAS (espelham o detalhe #233 — fonte única reusada):
 *  - UMA entrada por (receita, locale que TEM slug). Receita só-pt-BR ⇒ só a entrada pt-BR — NUNCA
 *    inventamos URL de locale inexistente.
 *  - `url` ABSOLUTA via `absoluteRecipeDetailUrl` (= `<base>/{locale}/recipes/{slug}`).
 *  - `alternates.languages` (hreflang) via `recipeHreflangAlternates` — liga os locales existentes +
 *    `x-default` → DEFAULT_LOCALE. O Next serializa isso como `<xhtml:link rel="alternate">`.
 *  - `lastModified` propagado de cada Receita (o maior `updated_at` entre espinha+traduções, vindo
 *    da query). Defensivo: Receita sem slug em locale algum ⇒ ZERO entradas (sem URL canônica).
 *
 * O gate de elegibilidade NÃO é reavaliado aqui (o caller só passa as elegíveis) — espelha o padrão
 * "kernel puro + casca fina de I/O" do `recipe-seo.ts`.
 */
import type { MetadataRoute } from 'next'
import {
  absoluteRecipeDetailUrl,
  recipeHreflangAlternates,
} from '@/domain/recipe-detail-route'
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, type Locale } from '@/i18n/locale'

/**
 * Insumo do builder — UMA Receita elegível com seus slugs POR locale (só os locales que TÊM slug
 * público entram no mapa, exatamente como `loadRecipeSlugMap` do detalhe) e um `lastModified`.
 */
export type SitemapRecipe = {
  /** Slug PÚBLICO por locale (só os com slug NÃO-NULL). Governa o hreflang e as entradas. */
  slugsByLocale: Partial<Record<Locale, string>>
  /** Última modificação (espinha/traduções) → `<lastmod>`. */
  lastModified: Date
}

/**
 * Achata as Receitas elegíveis em entradas do sitemap: UMA por (receita, locale com slug), com URL
 * absoluta canônica, `lastModified` da Receita, e o hreflang COMPLETO (todos os locales com slug +
 * x-default). Receita sem nenhum slug não gera entrada.
 */
export function buildSitemapEntries(
  recipes: ReadonlyArray<SitemapRecipe>,
  baseUrl: string,
): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = []
  for (const r of recipes) {
    // O hreflang é o MESMO mapa pra todas as entradas-irmãs desta Receita (reusa o do detalhe #233).
    const languages = recipeHreflangAlternates(baseUrl, r.slugsByLocale)
    for (const locale of SUPPORTED_LOCALES) {
      const slug = r.slugsByLocale[locale]
      if (!slug) continue // locale sem slug não vira URL — nunca inventamos
      entries.push({
        url: absoluteRecipeDetailUrl(baseUrl, locale, slug),
        lastModified: r.lastModified,
        alternates: { languages },
      })
    }
  }
  return entries
}

/**
 * Rotas estáticas indexáveis: a HOME por locale (`<base>/{locale}`). Cada home lista as outras no
 * hreflang + `x-default` → DEFAULT_LOCALE (espelha o prefix-all locale-no-caminho do ADR-0020). Sem
 * `lastModified` (a home é um feed sempre-fresco — sem data canônica de modificação).
 */
export function buildStaticLocaleEntries(baseUrl: string): MetadataRoute.Sitemap {
  const languages: Record<string, string> = {}
  for (const loc of SUPPORTED_LOCALES) languages[loc] = `${baseUrl}/${loc}`
  languages['x-default'] = `${baseUrl}/${DEFAULT_LOCALE}`

  return SUPPORTED_LOCALES.map((loc) => ({
    url: `${baseUrl}/${loc}`,
    alternates: { languages },
  }))
}
