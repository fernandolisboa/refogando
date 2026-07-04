import type { Database } from '@/db/client'
import { appConfig } from '@/db/schema'
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  DEFAULT_IMAGE_MODEL,
  isImageGenModel,
  type ImageGenConfig,
} from '@/domain/image-gen-config'
import {
  DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
  type RecipeGenCapByRole,
} from '@/domain/recipe-gen-config'
import {
  DEFAULT_RECIPE_VARIANT_CONFIG,
  parseRecipeVariantConfig,
  type RecipeVariantConfig,
} from '@/domain/recipe-variant-config'
import {
  DEFAULT_WEB_SEARCH_CONFIG,
  parseAllowlist,
  type WebSearchConfig,
} from '@/domain/web-search-config'
import {
  DEFAULT_CATALOG_DISCLOSURE_CONFIG,
  type CatalogDisclosureConfig,
} from '@/domain/catalog-disclosure-config'
import {
  DEFAULT_POPULARITY_CONFIG,
  parsePopularityConfig,
  type PopularityConfig,
} from '@/domain/popularity'

/**
 * Leitura do singleton `app_config` (issues #5/#134) — fonte ÚNICA da config de app, usada tanto pelo
 * route handler `/api/admin/config` (GET) quanto pela GERAÇÃO de imagem (que lê teto/modelo/enabled
 * daqui). Linha ausente (sem seed) ⇒ defaults EM CÓDIGO (o app funciona antes de qualquer PUT).
 *
 * O `default_model` (chat, #5), o `imageGen` (#134) e o `webSearch` (#164) coabitam a mesma linha
 * singleton. O `model` persistido é re-validado contra a allowlist (defensivo: linha legada/editada à
 * mão não quebra o tipo `ImageGenModel`); fora da allowlist ⇒ cai no default. A `webSearch.allowlist`
 * também é re-validada na leitura (re-canonicaliza/descarta lixo de linha legada) — fail-closed.
 */

export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8'

export type AppConfig = {
  defaultModel: string
  imageGen: ImageGenConfig
  // #167: teto diário de geração de RECEITA por papel (jsonb Record<Role, number|null>, `null` = ∞).
  recipeGenCapByRole: RecipeGenCapByRole
  // #423 (ADR-0029 dec.6): config da variação de geração ("gerar 2, o usuário escolhe") — liga/desliga
  // o opt-in + o eixo de divergência (poloA/poloB/instrucao), editável sem deploy.
  recipeVariant: RecipeVariantConfig
  // #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios.
  webSearch: WebSearchConfig
  // #237: aviso OPCIONAL de catálogo AI-assistido (SEO #187) — liga/desliga + texto editável.
  catalogDisclosure: CatalogDisclosureConfig
  // #368: constantes da mistura de popularidade (pesos + m + tauDays) — ranking da Busca e do trilho.
  popularity: PopularityConfig
}

export async function loadAppConfig(db: Database): Promise<AppConfig> {
  const [row] = await db.select().from(appConfig)
  if (!row) {
    return {
      defaultModel: DEFAULT_CHAT_MODEL,
      imageGen: DEFAULT_IMAGE_GEN_CONFIG,
      recipeGenCapByRole: DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
      recipeVariant: DEFAULT_RECIPE_VARIANT_CONFIG,
      webSearch: DEFAULT_WEB_SEARCH_CONFIG,
      catalogDisclosure: DEFAULT_CATALOG_DISCLOSURE_CONFIG,
      popularity: DEFAULT_POPULARITY_CONFIG,
    }
  }
  // #368: re-valida na leitura — jsonb legado/editado à mão com lixo (peso negativo, m<=0, Infinity
  // serializado como null, etc.) cai no DEFAULT (fail-safe), nunca envenena o ranking com uma config
  // inválida. Mesma disciplina do webSearch.allowlist / imageGen.model.
  const parsedPopularity = parsePopularityConfig(row.popularityConfig)
  // #423: re-valida na leitura — jsonb legado/editado à mão com pólo/instrução vazios cai no DEFAULT
  // (fail-safe), nunca compõe um fragmento de prompt sem norte. Mesma disciplina do popularity/webSearch.
  const parsedVariant = parseRecipeVariantConfig(row.recipeVariantConfig)
  return {
    defaultModel: row.defaultModel,
    imageGen: {
      enabled: row.imageGenEnabled,
      model: isImageGenModel(row.imageGenModel) ? row.imageGenModel : DEFAULT_IMAGE_MODEL,
      dailyCapByRole: row.imageGenCapByRole,
    },
    recipeGenCapByRole: row.recipeGenCapByRole,
    recipeVariant: parsedVariant.ok ? parsedVariant.value : DEFAULT_RECIPE_VARIANT_CONFIG,
    webSearch: {
      enabled: row.webSearchEnabled,
      // Re-valida na leitura: linha legada/editada à mão com lixo cai em `[]` (fail-closed), nunca
      // um domínio não-canônico vaza pro guard de SSRF / endpoint.
      allowlist: parseAllowlist(row.webSearchAllowlist) ?? [],
    },
    catalogDisclosure: {
      enabled: row.catalogDisclosureEnabled,
      // Re-valida na leitura: texto vazio/só-espaço (linha editada à mão) cai no default — o aviso
      // nunca renderiza uma frase vazia. As colunas têm NOT NULL + default, então o caso normal já é seguro.
      text:
        row.catalogDisclosureText.trim() !== ''
          ? row.catalogDisclosureText.trim()
          : DEFAULT_CATALOG_DISCLOSURE_CONFIG.text,
    },
    popularity: parsedPopularity.ok ? parsedPopularity.value : DEFAULT_POPULARITY_CONFIG,
  }
}

/** Atalho: só a config de popularidade (#368) — usada pelo loader da Busca e do trilho de Cozinheiros. */
export async function loadPopularityConfig(db: Database): Promise<PopularityConfig> {
  return (await loadAppConfig(db)).popularity
}

/** Atalho: só a config do aviso de catálogo AI-assistido (#237) — usada pelo detalhe da Receita. */
export async function loadCatalogDisclosureConfig(db: Database): Promise<CatalogDisclosureConfig> {
  return (await loadAppConfig(db)).catalogDisclosure
}

/** Atalho: só a config de geração de imagem (a geração não precisa do default_model do chat). */
export async function loadImageGenConfig(db: Database): Promise<ImageGenConfig> {
  return (await loadAppConfig(db)).imageGen
}

/** Atalho: só a config da variação de geração (#423) — usada pela rota de geração e pela home/create. */
export async function loadRecipeVariantConfig(db: Database): Promise<RecipeVariantConfig> {
  return (await loadAppConfig(db)).recipeVariant
}

/** Atalho: só a config de descoberta na web (#164) — usada pelo endpoint e pelo guard de SSRF do import. */
export async function loadWebSearchConfig(db: Database): Promise<WebSearchConfig> {
  return (await loadAppConfig(db)).webSearch
}
