/**
 * Tabela `pro` dos tetos de cota — Fase 2 de billing (eixo `plan`, #466). PURO: tipo + validação.
 *
 * É o "tudo ou nada" da concessão `pro`: um ÚNICO bundle `{ recipeGen, imageGen, extraction }` com os
 * três tetos por papel da tabela PRO. Persistido como uma coluna jsonb NULLABLE em `app_config`
 * (`pro_caps`): NULL = "nenhuma tabela pro configurada" ⇒ a resolução de teto (`capFrom*`) IGNORA o
 * plano e cai na tabela de hoje (`caps`) — comportamento BYTE-IDÊNTICO ao atual. Só quando o admin
 * grava um bundle VÁLIDO E o usuário é `plan='pro'` o teto vem da tabela pro. NÃO ativa cobrança.
 *
 * Cada eixo reusa o MESMO validador da tabela livre correspondente (`parseRecipeGenCapByRole` /
 * `parseImageGenCapByRole` / `parseExtractionCapByRole`) — fonte ÚNICA da forma `Record<Role, number|null>`
 * (`null` = ∞, inteiro ≥ 0, exatamente os papéis conhecidos). QUALQUER eixo ausente/inválido ⇒ o bundle
 * inteiro é rejeitado (`null`): "tudo ou nada", nunca uma tabela pro pela metade.
 */

import { parseRecipeGenCapByRole, type RecipeGenCapByRole } from '@/domain/recipe-gen-config'
import { parseImageGenCapByRole, type ImageGenCapByRole } from '@/domain/image-gen-config'
import { parseExtractionCapByRole, type ExtractionCapByRole } from '@/domain/extraction-cap-config'

/** Bundle dos tetos PRO (tabela `pro`). Forma espelha os três eixos livres, um por dimensão de cota. */
export type ProCaps = {
  recipeGen: RecipeGenCapByRole
  imageGen: ImageGenCapByRole
  extraction: ExtractionCapByRole
}

/**
 * Valida o bundle `proCaps` cru (entrada do PUT do admin E re-validação na leitura do jsonb). Exige um
 * objeto com os TRÊS eixos, cada um um teto-por-papel válido. Ausência/lixo em QUALQUER eixo ⇒ `null`
 * (tudo-ou-nada — sem tabela pro pela metade). Sem `as`: estreita por checagem. `null` no persist = a
 * concessão pro é IGNORADA (byte-idêntico ao free).
 */
export function parseProCaps(raw: unknown): ProCaps | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as { recipeGen?: unknown; imageGen?: unknown; extraction?: unknown }
  const recipeGen = parseRecipeGenCapByRole(obj.recipeGen)
  const imageGen = parseImageGenCapByRole(obj.imageGen)
  const extraction = parseExtractionCapByRole(obj.extraction)
  if (recipeGen === null || imageGen === null || extraction === null) return null
  return { recipeGen, imageGen, extraction }
}
