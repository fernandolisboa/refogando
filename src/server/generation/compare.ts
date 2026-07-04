/**
 * Runner do comparador de prompt (issue #425, ADR-0029 dec.7) — SERVIDOR. Roda UM lado (velho|novo)
 * de UMA fixture: monta `{ systemPrompt, userPrompt }` (via o domínio PURO `comparatorPrompt`),
 * chama o seam mockável do Claude com a saída constrita ao vocabulário fixo do comparador, classifica
 * pela taxonomia canônica (`classify`) e, se `withImage` e houver Receita, gera a imagem do PRATO
 * (ADR-0022 — o prato é SEMPRE o sujeito) pela semente determinística da fixture.
 *
 * ZERO escrita de DB: NÃO chama `persistGeneration` nem embed nem toca `recipe_image`. É uma bancada
 * admin read-only — a saída é um DTO PURO. Reusa os MESMOS seams de produção (getClaudeClient /
 * getImageGenerator) para o comparador refletir o pipeline real; os testes injetam dublês.
 *
 * Invariantes (ADR-0029): a variedade vem do CONTEÚDO do prompt — NUNCA de `temperature`/`top_p`/
 * `seed` (Opus 4.8 os rejeita com 400); o consultivo trafega FORA da Receita; a cozinha é vocabulário
 * controlado (a IA não inventa). Nada disso muda aqui — só EXIBIMOS o antes/depois.
 */

import { getClaudeClient, getImageGenerator } from '@/server/deps'
import { classify } from '@/domain/generation'
import { buildDishImagePrompt, composeImagePrompt } from '@/domain/image-prompt'
import {
  comparatorPrompt,
  recipeView,
  COMPARATOR_COZINHA_SLUGS,
  type ComparatorFixture,
  type ComparatorSideResult,
  type ComparisonSide,
} from '@/domain/prompt-comparator'

export type RunComparisonOptions = {
  /** Modelo resolvido na borda (de `app_config.default_model`, com fallback em código). */
  model: string
  /** Gera a imagem do prato quando houve Receita (opt-in; default é texto-só). */
  withImage: boolean
}

/**
 * Roda UM lado da comparação de UMA fixture e devolve o DTO puro. Sem persistência.
 *
 * Fluxo: `comparatorPrompt` monta os prompts (userPrompt idêntico nos dois lados; systemPrompt VIVO
 * no `new`, BASELINE congelado no `old`) → `generateRecipe` com `cozinhaSlugs` fixo (constrange a
 * SAÍDA ao vocabulário controlado) e `axes` da fixture (proveniência; já embutidos no systemPrompt)
 * → `classify`. Se `withImage` e a Receita veio, compõe o prompt da imagem do PRATO com a fixture.id
 * como semente (estilo determinístico/reproduzível) e chama o gerador; a imagem volta como `data:` URL.
 */
export async function runComparison(
  fixture: ComparatorFixture,
  side: ComparisonSide,
  options: RunComparisonOptions,
): Promise<ComparatorSideResult> {
  const { systemPrompt, userPrompt } = comparatorPrompt(fixture, side)

  const out = await getClaudeClient().generateRecipe({
    systemPrompt,
    userPrompt,
    model: options.model,
    // Constrange a cozinha da SAÍDA ao vocabulário fixo do comparador (ADR-0025): a IA não inventa cozinha.
    cozinhaSlugs: COMPARATOR_COZINHA_SLUGS,
    // Proveniência (#420): eixos que produziram esta geração — já codificados no systemPrompt. Neutro na Wave 1.
    axes: fixture.axes,
  })
  const result = classify(out)

  // Sem Receita entregue (impossible|invalid) → sem imagem; a UI mostra só o outcome/advisory.
  if (result.outcome !== 'success' && result.outcome !== 'degraded' && result.outcome !== 'playful') {
    return {
      side,
      systemPrompt,
      outcome: result.outcome,
      recipe: null,
      advisory: result.outcome === 'impossible' ? result.advisory : null,
      imageDataUrl: null,
    }
  }

  const recipe = result.recipe
  let imageDataUrl: string | null = null
  if (options.withImage) {
    // ADR-0022: o PRATO é SEMPRE o sujeito. `fixture.id` é a semente do hash de rotação de estilo
    // (#424) — mesma fixture ⇒ mesma estética (reproduzível); lados velho/novo divergem só porque a
    // Receita (título/ingredientes) diverge. Sem override do usuário (bancada automática).
    const base = buildDishImagePrompt({
      recipeId: fixture.id,
      titulo: recipe.titulo,
      cozinha: recipe.cozinha,
      categoria: recipe.categoria,
      ingredientes: recipe.ingredientes.map((ing) => ing.nome),
    })
    // Sem `model`: o gerador cai no default de imagem (Nano Banana / DEFAULT_IMAGE_MODEL). NÃO passar
    // aqui o `options.model` (que é o modelo de TEXTO do Claude) — são famílias distintas de modelo.
    const img = await getImageGenerator().generateDishImage({
      prompt: composeImagePrompt(base),
    })
    imageDataUrl = `data:${img.contentType};base64,${img.data.toString('base64')}`
  }

  return {
    side,
    systemPrompt,
    outcome: result.outcome,
    recipe: recipeView(recipe),
    advisory: result.advisory,
    imageDataUrl,
  }
}
