import type { Database } from '@/db/client'
import { appConfig } from '@/db/schema'
import { DEFAULT_TASK_MODEL, DEFAULT_TEXT_MODEL } from '@/domain/claude-models'
import {
  activeSettings,
  parseStoredAiTasks,
  resolveAiTasks,
  type AiTask,
  type AiTasksConfig,
  type ModelSettings,
} from '@/domain/ai-task-config'
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
  DEFAULT_EXTRACTION_CAP_BY_ROLE,
  type ExtractionCapByRole,
} from '@/domain/extraction-cap-config'
import { parseProCaps, type ProCaps } from '@/domain/pro-caps'
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
import {
  DEFAULT_SOCIAL_LINKS_CONFIG,
  parseSocialLinksConfig,
  type SocialLinksConfig,
} from '@/domain/social-links-config'
import {
  DEFAULT_RECIPE_OF_WEEK_CONFIG,
  parseRecipeOfWeekConfig,
  type RecipeOfWeekConfig,
} from '@/domain/recipe-of-week-config'

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

/**
 * Modelo de Tradução/Extração enquanto o admin não escolheu um (ADR-0034): a env var legada (ADR-0030
 * dec.2 / #112) ou Sonnet 5. Lido no load do módulo, como antes.
 */
export const TASK_FALLBACK_MODELS = {
  translation: process.env.TRANSLATION_MODEL ?? DEFAULT_TASK_MODEL,
  extraction: process.env.EXTRACTION_MODEL ?? DEFAULT_TASK_MODEL,
}

export type AppConfig = {
  defaultModel: string
  // ADR-0034: modelo + ajustes (esforço, thinking) por tarefa de IA de texto. `generation.model` ===
  // `defaultModel` (a coluna segue a fonte do modelo da Geração).
  aiTasks: AiTasksConfig
  imageGen: ImageGenConfig
  // #167: teto diário de geração de RECEITA por papel (jsonb Record<Role, number|null>, `null` = ∞).
  recipeGenCapByRole: RecipeGenCapByRole
  // #447: teto diário de EXTRAÇÃO de ingredientes por papel (mesma forma; defaults mais folgados).
  extractionCapByRole: ExtractionCapByRole
  // #423 (ADR-0029 dec.6): config da variação de geração ("gerar 2, o usuário escolhe") — liga/desliga
  // o opt-in + o eixo de divergência (poloA/poloB/instrucao), editável sem deploy.
  recipeVariant: RecipeVariantConfig
  // #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios.
  webSearch: WebSearchConfig
  // #237: aviso OPCIONAL de catálogo AI-assistido (SEO #187) — liga/desliga + texto editável.
  catalogDisclosure: CatalogDisclosureConfig
  // #368: constantes da mistura de popularidade (pesos + m + tauDays) — ranking da Busca e do trilho.
  popularity: PopularityConfig
  // #451: links de redes sociais do site (footer), editáveis pelo admin sem deploy.
  socialLinks: SocialLinksConfig
  // #457: "Receita da semana" — slot editorial da home. `recipeId: null` ⇒ fallback por Popularidade.
  recipeOfWeek: RecipeOfWeekConfig
  // Fase 2 de billing (#466): tabela `pro` dos tetos de cota (`{ recipeGen, imageGen, extraction }`).
  // `null` = NENHUMA tabela pro ⇒ a resolução ignora o plano e cai na tabela livre (teto de hoje).
  proCaps: ProCaps | null
}

export async function loadAppConfig(db: Database): Promise<AppConfig> {
  const [row] = await db.select().from(appConfig)
  if (!row) {
    return {
      defaultModel: DEFAULT_TEXT_MODEL,
      aiTasks: resolveAiTasks({}, { generation: DEFAULT_TEXT_MODEL, ...TASK_FALLBACK_MODELS }),
      imageGen: DEFAULT_IMAGE_GEN_CONFIG,
      recipeGenCapByRole: DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
      extractionCapByRole: DEFAULT_EXTRACTION_CAP_BY_ROLE,
      recipeVariant: DEFAULT_RECIPE_VARIANT_CONFIG,
      webSearch: DEFAULT_WEB_SEARCH_CONFIG,
      catalogDisclosure: DEFAULT_CATALOG_DISCLOSURE_CONFIG,
      popularity: DEFAULT_POPULARITY_CONFIG,
      socialLinks: DEFAULT_SOCIAL_LINKS_CONFIG,
      recipeOfWeek: DEFAULT_RECIPE_OF_WEEK_CONFIG,
      // Fase 2: sem linha ⇒ sem tabela pro ⇒ resolução byte-idêntica ao free.
      proCaps: null,
    }
  }
  // #368: re-valida na leitura — jsonb legado/editado à mão com lixo (peso negativo, m<=0, Infinity
  // serializado como null, etc.) cai no DEFAULT (fail-safe), nunca envenena o ranking com uma config
  // inválida. Mesma disciplina do webSearch.allowlist / imageGen.model.
  const parsedPopularity = parsePopularityConfig(row.popularityConfig)
  // #423: re-valida na leitura — jsonb legado/editado à mão com pólo/instrução vazios cai no DEFAULT
  // (fail-safe), nunca compõe um fragmento de prompt sem norte. Mesma disciplina do popularity/webSearch.
  const parsedVariant = parseRecipeVariantConfig(row.recipeVariantConfig)
  // #451: re-valida na leitura — linha legada/editada à mão com lixo (URL insegura, plataforma
  // desconhecida, duplicada) cai em [] (fail-safe), nunca vaza um link inválido pro footer.
  const parsedSocial = parseSocialLinksConfig(row.socialLinks)
  // #457: re-valida na leitura — jsonb legado/editado à mão com `recipeId` malformado cai no DEFAULT
  // (`null` ⇒ fallback de Popularidade), nunca propaga um id de forma inválida pro loader do slot.
  const parsedRecipeOfWeek = parseRecipeOfWeekConfig(row.recipeOfWeekConfig)
  return {
    defaultModel: row.defaultModel,
    // Re-valida na leitura: jsonb legado/editado à mão com lixo cai nos defaults por item (fail-safe).
    aiTasks: resolveAiTasks(parseStoredAiTasks(row.aiTasks), {
      generation: row.defaultModel,
      ...TASK_FALLBACK_MODELS,
    }),
    imageGen: {
      enabled: row.imageGenEnabled,
      model: isImageGenModel(row.imageGenModel) ? row.imageGenModel : DEFAULT_IMAGE_MODEL,
      dailyCapByRole: row.imageGenCapByRole,
    },
    recipeGenCapByRole: row.recipeGenCapByRole,
    extractionCapByRole: row.extractionCapByRole,
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
    socialLinks: parsedSocial.ok ? parsedSocial.value : DEFAULT_SOCIAL_LINKS_CONFIG,
    recipeOfWeek: parsedRecipeOfWeek.ok ? parsedRecipeOfWeek.value : DEFAULT_RECIPE_OF_WEEK_CONFIG,
    // Fase 2: re-valida na leitura — jsonb NULL (default) OU legado/editado à mão com um eixo
    // ausente/inválido cai em `null` (fail-safe: a resolução ignora o plano e usa a tabela livre, teto
    // de hoje). Nunca eleva um teto a partir de um bundle pro pela metade. Mesma disciplina dos demais.
    proCaps: parseProCaps(row.proCaps),
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

/** Atalho: só os links de redes sociais do site (#451) — usado pelo layout p/ threadar ao footer. */
export async function loadSocialLinksConfig(db: Database): Promise<SocialLinksConfig> {
  return (await loadAppConfig(db)).socialLinks
}

/** Atalho: só a config da "Receita da semana" (#457) — usado pelo loader do slot editorial da home. */
export async function loadRecipeOfWeekConfig(db: Database): Promise<RecipeOfWeekConfig> {
  return (await loadAppConfig(db)).recipeOfWeek
}

/**
 * Atalho: só a tabela `pro` dos tetos de cota (Fase 2, #466) — usado pelos call-sites de cota que
 * ainda NÃO leem o app_config inteiro (ex.: `image.ts` já lê `loadImageGenConfig`). `null` = sem
 * tabela pro ⇒ o caller passa `null` a `capFrom*` e o teto fica byte-idêntico ao free.
 */
export async function loadProCaps(db: Database): Promise<ProCaps | null> {
  return (await loadAppConfig(db)).proCaps
}

/** Atalho (ADR-0034): o modelo em uso + o ajuste efetivo de UMA tarefa de IA de texto. */
export async function loadAiTask(
  db: Database,
  task: AiTask,
): Promise<{ model: string; settings: ModelSettings }> {
  const state = (await loadAppConfig(db)).aiTasks[task]
  return { model: state.model, settings: activeSettings(task, state) }
}
