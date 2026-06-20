import type { Database } from '@/db/client'
import { appConfig } from '@/db/schema'
import {
  DEFAULT_IMAGE_GEN_CONFIG,
  DEFAULT_IMAGE_MODEL,
  isImageGenModel,
  type ImageGenConfig,
} from '@/domain/image-gen-config'

/**
 * Leitura do singleton `app_config` (issues #5/#134) — fonte ÚNICA da config de app, usada tanto pelo
 * route handler `/api/admin/config` (GET) quanto pela GERAÇÃO de imagem (que lê teto/modelo/enabled
 * daqui). Linha ausente (sem seed) ⇒ defaults EM CÓDIGO (o app funciona antes de qualquer PUT).
 *
 * O `default_model` (chat, #5) e o `imageGen` (#134) coabitam a mesma linha singleton. O `model`
 * persistido é re-validado contra a allowlist (defensivo: linha legada/editada à mão não quebra o
 * tipo `ImageGenModel`); fora da allowlist ⇒ cai no default.
 */

export const DEFAULT_CHAT_MODEL = 'claude-opus-4-8'

export type AppConfig = {
  defaultModel: string
  imageGen: ImageGenConfig
}

export async function loadAppConfig(db: Database): Promise<AppConfig> {
  const [row] = await db.select().from(appConfig)
  if (!row) {
    return { defaultModel: DEFAULT_CHAT_MODEL, imageGen: DEFAULT_IMAGE_GEN_CONFIG }
  }
  return {
    defaultModel: row.defaultModel,
    imageGen: {
      enabled: row.imageGenEnabled,
      model: isImageGenModel(row.imageGenModel) ? row.imageGenModel : DEFAULT_IMAGE_MODEL,
      dailyCapByRole: row.imageGenCapByRole,
    },
  }
}

/** Atalho: só a config de geração de imagem (a geração não precisa do default_model do chat). */
export async function loadImageGenConfig(db: Database): Promise<ImageGenConfig> {
  return (await loadAppConfig(db)).imageGen
}
