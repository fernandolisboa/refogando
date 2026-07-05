import { and, eq, isNull, ne } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation } from '@/db/schema'
import { communityVisibleCondition } from '@/server/recipe/visibility-filter'
import { loadRecipeTranslationContext } from '@/server/recipe/load'
import { fingerprintSource, fingerprintMt } from '@/domain/translation-fingerprint'
import { isDefasadaEDivergente } from '@/domain/translation-divergent-stale'
import { TRANSLATION_PROMPT_VERSION } from '@/domain/translation-prompt'

/**
 * Lista do Curador — traduções DEFASADAS-E-DIVERGENTES (issue #500, ADR-0031 decisão 6).
 * "Outro lado da moeda" da re-tradução automática (fatia B, #499): aqui, o CONTEÚDO da linha
 * já diverge da última MT (edição humana) — ou é legado sem prova de intocabilidade — então a
 * re-tradução automática NUNCA a toca; ela precisa de re-revisão HUMANA pela rota de edição de
 * tradução já existente (`PATCH /api/recipes/[id]/translations/[locale]`, #498).
 *
 * Query PULL-DERIVED: a comparação de hash roda NO APP (ADR-0031 dec.4 — nunca em SQL). Passo a
 * passo:
 *  1. Candidatas = linhas `recipe_translation` DERIVADAS (`locale != recipe.original_locale`) de
 *     Receita da COMUNIDADE (mesmo gate de `translations/stale/route.ts`: comunidade OU catálogo
 *     aprovado, E `moderation_removed_at IS NULL` — nunca vaza privada nem removida do pool).
 *  2. Agrupa por `recipeId` (evita recarregar a mesma Receita por linha candidata quando há >1
 *     locale derivado) e usa `loadRecipeTranslationContext` — O MESMO loader que `ensureTranslation`
 *     usa para montar a fonte — para reconstruir `fingerprintSource`/`fingerprintMt` ATUAIS com a
 *     MESMA construção de campos (locale original + `raw_text` dos ingredientes; linha atual + mapa
 *     `ordem→nome` do jsonb, sem `nomeOrigem`) — espelha `ensureTranslation` byte-a-byte.
 *  3. `isDefasadaEDivergente` (domínio puro) decide por comparação; entra na lista só quando AMBAS.
 *
 * Devolve só id+locale+proveniência (nada de conteúdo sensível) — mesmo contrato de
 * `translations/stale/route.ts`. Read-only (nenhuma escrita, nenhuma chamada a LLM).
 */
export type DivergentStaleItem = {
  recipeId: string
  locale: string
  provenance: string
}

export async function loadDivergentStaleTranslations(db: Database): Promise<DivergentStaleItem[]> {
  // 1. Candidatas: derivadas + comunidade + não-moderadas (mesmo gate do template `stale/route.ts`).
  const candidates = await db
    .select({
      recipeId: recipeTranslation.recipeId,
      locale: recipeTranslation.locale,
      provenance: recipeTranslation.provenance,
      sourceFingerprint: recipeTranslation.sourceFingerprint,
      mtFingerprint: recipeTranslation.mtFingerprint,
      promptVersion: recipeTranslation.promptVersion,
    })
    .from(recipeTranslation)
    .innerJoin(recipe, eq(recipe.id, recipeTranslation.recipeId))
    .where(
      and(
        ne(recipeTranslation.locale, recipe.originalLocale),
        communityVisibleCondition(recipe),
        // #18: exclui Receita removida do pool pela moderação (recipe-pool.ts) — mesma cláusula
        // do template `stale/route.ts` (faltar este gate vaza Receita já moderada).
        isNull(recipe.moderationRemovedAt),
      ),
    )
    .orderBy(recipeTranslation.recipeId, recipeTranslation.locale)

  if (candidates.length === 0) return []

  // 2. Agrupa por Receita — 1 `loadRecipeTranslationContext` por Receita, não por linha candidata.
  const byRecipe = new Map<string, typeof candidates>()
  for (const c of candidates) {
    const list = byRecipe.get(c.recipeId)
    if (list) list.push(c)
    else byRecipe.set(c.recipeId, [c])
  }

  const out: DivergentStaleItem[] = []

  for (const [recipeId, rows] of byRecipe) {
    const ctx = await loadRecipeTranslationContext(db, recipeId)
    if (!ctx) continue // defensivo: a Receita sumiu entre as duas leituras

    // Fonte = tradução do locale ORIGINAL (a mesma que ensureTranslation usa como `source`).
    const source = ctx.translations.find((t) => t.locale === ctx.originalLocale)
    if (!source) continue // sem fonte, nada a comparar (não deveria ocorrer em dado consistente)

    // Espelha `ensureTranslation`: campos traduzíveis do original + `raw_text` (ordem+nome, filtrado
    // vazio) dos ingredientes — EXATAMENTE `ctx.ingredients` (o mesmo insumo do write-path).
    const currentSourceFingerprint = fingerprintSource({
      titulo: source.titulo,
      descricao: source.descricao,
      passos: source.passos,
      notas: source.notas,
      ingredientes: ctx.ingredients,
    })

    for (const candidate of rows) {
      const currentRow = ctx.translations.find((t) => t.locale === candidate.locale)
      if (!currentRow) continue // corrida: a linha sumiu entre as duas leituras

      // Espelha `ensureTranslation`: campos da linha + mapa `ordem→nome` do jsonb (sem `nomeOrigem`,
      // que é escrituração — fora do hash). jsonb `null` (sem ingrediente nomeado) ⇒ `null`, nunca `[]`.
      const currentMtFingerprint = fingerprintMt({
        titulo: currentRow.titulo,
        descricao: currentRow.descricao,
        passos: currentRow.passos,
        notas: currentRow.notas,
        ingredientes: currentRow.ingredientes
          ? currentRow.ingredientes.map((i) => ({ ordem: i.ordem, nome: i.nome }))
          : null,
      })

      const divergentAndStale = isDefasadaEDivergente({
        currentSourceFingerprint,
        storedSourceFingerprint: candidate.sourceFingerprint,
        storedPromptVersion: candidate.promptVersion,
        translationPromptVersion: TRANSLATION_PROMPT_VERSION,
        currentMtFingerprint,
        storedMtFingerprint: candidate.mtFingerprint,
      })

      if (divergentAndStale) {
        out.push({ recipeId: candidate.recipeId, locale: candidate.locale, provenance: candidate.provenance })
      }
    }
  }

  return out
}
