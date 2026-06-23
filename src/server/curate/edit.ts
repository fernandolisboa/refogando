import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeTag, tag } from '@/db/schema'
import type { Cozinha, Categoria, Restricao } from '@/domain/vocabulary'
import { isTranslatableField } from '@/domain/stale-rule'
import { applyEdit } from '@/server/recipe/edit'

/**
 * Edição/“organização” de Receita de CATÁLOGO pelo Curador (issue #19, AC1/AC6).
 *
 * Dois eixos no MESMO PATCH:
 *  - TRADUZÍVEL (titulo/descricao/passos/notas): UPDATE de `recipe_translation` (linha
 *    (recipeId, locale)) + `applyEdit` marca o locale stale e re-embeda (AC6, regra de #3).
 *  - CATEGORIZAÇÃO/INVARIANTE (cozinha/categoria/restricoes/tags/porcoes/dificuldade):
 *    UPDATE de `recipe`/`recipe_tag`; NÃO marca stale (decideStale é no-op para campos
 *    não-traduzíveis — chamamos `applyEdit` com os changedFields presentes, e a regra de
 *    #3 decide; nunca re-derivamos “quando marcar”).
 *
 * GATE da linha de tradução: se há QUALQUER campo traduzível no patch, exige que exista a
 * linha (recipeId, locale) ANTES de delegar a `applyEdit` (espelha review/route.ts) —
 * senão um UPDATE de 0 linhas seria no-op silencioso (200 + edit perdido). Devolve
 * 'translation_not_found' (route mapeia 404). Patch SÓ de categorização/invariante NÃO
 * precisa do gate de tradução.
 *
 * `changedFields` = campos PRESENTES no patch (semântica PATCH; sem diff de valor — a
 * otimização de diff real é futura). Ordem: UPDATEs de conteúdo ANTES de `applyEdit`
 * (o re-embed dentro dele lê o texto novo).
 *
 * NÃO-atomicidade tolerada (espelha src/server/recipe/edit.ts): o PATCH compõe transações
 * independentes (UPDATE de tradução, UPDATE de recipe, tx de tags, `applyEdit`). Uma falha
 * PARCIAL é aceitável porque `stale` é MONOTÔNICO (marcar a mais nunca corrompe) e o
 * re-embed é RETRYABLE (recompute idempotente). O único early-return — `translation_not_
 * found` — acontece ANTES de qualquer outra escrita, então nunca deixa estado pela metade.
 */

export type EditCatalogRecipeInput = {
  recipeId: string
  locale: string // já resolvido/canonicalizado pela borda
  // Traduzíveis (presença = mudou):
  titulo?: string
  descricao?: string | null
  passos?: string[] | null
  notas?: string | null
  // Categorização/invariante (presença = mudou):
  cozinha?: Cozinha | null
  categoria?: Categoria | null
  restricoes?: Restricao[]
  porcoes?: number | null
  dificuldade?: number | null
  tags?: string[]
}

export async function editCatalogRecipe(
  db: Database,
  input: EditCatalogRecipeInput,
): Promise<'ok' | 'translation_not_found'> {
  const changedFields: string[] = []

  // Mapa de campos traduzíveis presentes.
  const translatablePatch: Record<string, unknown> = {}
  if (input.titulo !== undefined) {
    translatablePatch.titulo = input.titulo
    changedFields.push('titulo')
  }
  if (input.descricao !== undefined) {
    translatablePatch.descricao = input.descricao
    changedFields.push('descricao')
  }
  if (input.passos !== undefined) {
    translatablePatch.passos = input.passos
    changedFields.push('passos')
  }
  if (input.notas !== undefined) {
    translatablePatch.notas = input.notas
    changedFields.push('notas')
  }

  // Categorização/invariante presentes em `recipe`.
  const recipePatch: Record<string, unknown> = {}
  if (input.cozinha !== undefined) {
    recipePatch.cozinha = input.cozinha
    changedFields.push('cozinha')
  }
  if (input.categoria !== undefined) {
    recipePatch.categoria = input.categoria
    changedFields.push('categoria')
  }
  if (input.restricoes !== undefined) {
    recipePatch.restricoes = input.restricoes
    changedFields.push('restricoes')
  }
  if (input.porcoes !== undefined) {
    recipePatch.porcoes = input.porcoes
    changedFields.push('porcoes')
  }
  if (input.dificuldade !== undefined) {
    recipePatch.dificuldade = input.dificuldade
    changedFields.push('dificuldade')
  }

  const touchesTranslatable = changedFields.some(isTranslatableField)

  // 1. UPDATE de conteúdo traduzível ANTES de tudo (o re-embed lê o texto novo) E como
  //    GATE da linha de tradução numa só ida: o `RETURNING` vazio = linha (recipeId,
  //    locale) AUSENTE (predicado idêntico ao antigo SELECT-gate, sem condição extra;
  //    touchesTranslatable ≡ translatablePatch não-vazio, logo 0 linhas = ausente sem
  //    ambiguidade). Early-return ANTES de tocar recipe/tags/applyEdit ⇒ sem escrita
  //    parcial. (route mapeia 'translation_not_found' → 404.)
  if (touchesTranslatable) {
    // CONGELAMENTO do slug (#243, ADR-0020 dec.4): o `translatablePatch` cobre SÓ titulo/descricao/
    // passos/notas — NUNCA `slug`. Renomear/revisar o título aqui NÃO re-deriva a URL canônica (que
    // só o 1º insert materializa via freezeSlug). Não adicionar `slug` a este SET é a invariante.
    const updated = await db
      .update(recipeTranslation)
      .set({ ...translatablePatch, updatedAt: new Date() })
      .where(
        and(eq(recipeTranslation.recipeId, input.recipeId), eq(recipeTranslation.locale, input.locale)),
      )
      .returning({ id: recipeTranslation.id })
    if (updated.length === 0) return 'translation_not_found'
  }

  // 2. UPDATE de categorização/invariante em `recipe` (NUNCA toca origin/visibility/owner).
  if (Object.keys(recipePatch).length > 0) {
    await db
      .update(recipe)
      .set({ ...recipePatch, updatedAt: new Date() })
      .where(eq(recipe.id, input.recipeId))
  }

  // 3. Tags (organizar): delete-all + re-insert por nome NORMALIZADO (lower+trim),
  //    resolvendo/criando a linha `tag` (tag_nome_uq). Presença de `tags` = re-liga.
  if (input.tags !== undefined) {
    const tags = input.tags // const local preserva o narrow string[] dentro do closure async
    await db.transaction(async (tx) => {
      await tx.delete(recipeTag).where(eq(recipeTag.recipeId, input.recipeId))
      const seen = new Set<string>()
      for (const nome of tags) {
        const normalized = nome.toLowerCase().trim()
        if (normalized.length === 0 || seen.has(normalized)) continue
        seen.add(normalized)
        const [tagRow] = await tx
          .insert(tag)
          .values({ nome: normalized })
          .onConflictDoUpdate({ target: tag.nome, set: { nome: normalized } })
          .returning({ id: tag.id })
        await tx.insert(recipeTag).values({ recipeId: input.recipeId, tagId: tagRow.id })
      }
    })
  }

  // 4. Regra de #3 como fonte ÚNICA de stale/re-embed. Decisão vazia (só
  //    categorização/invariante) ⇒ applyStaleDecision no-op ⇒ zero stale/re-embed.
  await applyEdit(db, { recipeId: input.recipeId, locale: input.locale, changedFields })

  return 'ok'
}
