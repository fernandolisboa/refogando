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
  DEFAULT_WEB_SEARCH_CONFIG,
  parseAllowlist,
  type WebSearchConfig,
} from '@/domain/web-search-config'

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
  // #164: descoberta na web (ADR-0019) — liga/desliga + allowlist de domínios.
  webSearch: WebSearchConfig
}

export async function loadAppConfig(db: Database): Promise<AppConfig> {
  const [row] = await db.select().from(appConfig)
  if (!row) {
    return {
      defaultModel: DEFAULT_CHAT_MODEL,
      imageGen: DEFAULT_IMAGE_GEN_CONFIG,
      recipeGenCapByRole: DEFAULT_RECIPE_GEN_CAP_BY_ROLE,
      webSearch: DEFAULT_WEB_SEARCH_CONFIG,
    }
  }
  return {
    defaultModel: row.defaultModel,
    imageGen: {
      enabled: row.imageGenEnabled,
      model: isImageGenModel(row.imageGenModel) ? row.imageGenModel : DEFAULT_IMAGE_MODEL,
      dailyCapByRole: row.imageGenCapByRole,
    },
    recipeGenCapByRole: row.recipeGenCapByRole,
    webSearch: {
      enabled: row.webSearchEnabled,
      // Re-valida na leitura: linha legada/editada à mão com lixo cai em `[]` (fail-closed), nunca
      // um domínio não-canônico vaza pro guard de SSRF / endpoint.
      allowlist: parseAllowlist(row.webSearchAllowlist) ?? [],
    },
  }
}

/** Atalho: só a config de geração de imagem (a geração não precisa do default_model do chat). */
export async function loadImageGenConfig(db: Database): Promise<ImageGenConfig> {
  return (await loadAppConfig(db)).imageGen
}

/** Atalho: só a config de descoberta na web (#164) — usada pelo endpoint e pelo guard de SSRF do import. */
export async function loadWebSearchConfig(db: Database): Promise<WebSearchConfig> {
  return (await loadAppConfig(db)).webSearch
}
