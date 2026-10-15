/**
 * Schema da saída structured do diretor de arte (ADR-0043) — SÓ servidor (zod). Separado de
 * `image-scene.ts` porque o modal de imagem importa os registros de lá, e importar este arquivo levaria
 * o zod inteiro para o bundle do client (mesma divisão de `menu-suggestion-limits.ts`).
 *
 * Plano e sem bounds (structured outputs rejeita `maxLength` em alguns modelos e `$defs` aninhados):
 * os tetos dos textos livres e a checagem dos enums valem na normalização (`normalizeDirectorScene`).
 */

import { z } from 'zod'

import { IMAGE_SCENE_ENQUADRAMENTOS, IMAGE_SCENE_REGISTROS } from '@/domain/image-scene'
import type { TextUsage } from '@/domain/text-cost'

export const ImageSceneDirectorSchema = z.object({
  registro: z.enum(IMAGE_SCENE_REGISTROS),
  enquadramento: z.enum(IMAGE_SCENE_ENQUADRAMENTOS),
  regiao: z.string().nullable(),
  detalhes: z.string().nullable(),
})
export type ImageSceneDirectorRaw = z.infer<typeof ImageSceneDirectorSchema>

/** Teto de tokens da resposta do diretor (quatro campos curtos). O thinking ligado ganha folga à parte. */
export const IMAGE_SCENE_DIRECTOR_MAX_TOKENS = 400

/**
 * Resultado do seam. Qualquer não-sucesso (recusa, saída nula, erro, prazo) é `failed`: a imagem segue
 * com as regras de reserva. O `usage` volta em todo desfecho que chegou a custar.
 */
export type ImageSceneDirectorOutput =
  | { kind: 'ok'; scene: ImageSceneDirectorRaw; usage?: TextUsage }
  | { kind: 'failed'; usage?: TextUsage }
