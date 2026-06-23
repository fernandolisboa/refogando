import { getDb } from '@/server/deps'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import type { ImportedRecipe } from '@/domain/recipe-import-parse'
import { slugForNewTranslation } from '@/server/recipe/slug'

/**
 * Persistência transacional da Receita IMPORTADA da web (#165, ADR-0019).
 *
 * DISTINTA de `persistGeneration` (#8): importar NÃO é um episódio de criação (sem Briefing, sem
 * creation_session, sem generation — não há IA gerando, é uma CÓPIA). Grava só a Receita + a Tradução
 * do locale de origem + os ingredientes, em UMA transação (pai antes de filhos), espelhando o caminho
 * success de `persistGeneration`.
 *
 * Invariantes inegociáveis (ADR-0019, fixados AQUI na persistência):
 *  - `origin = 'web_imported'` (Proveniência imutável — o trigger recipe_origin_immutable barra
 *    qualquer UPDATE futuro; no INSERT é livre).
 *  - `visibility = 'private'` SEMPRE — receita importada nasce e fica privada. O guard "nunca
 *    pública" (recusar o toggle de publicação) é a #168; aqui a receita já nasce segura.
 *  - `source_url`/`source_name` gravados p/ ATRIBUIÇÃO à fonte externa (nunca "por <Usuário>").
 *  - A Tradução do locale de origem nasce `automatica_nao_revisada` (espelha a Receita gerada): é
 *    conteúdo externo copiado, não escrito/revisado por pessoa nossa.
 *
 * `quantidade` viaja como string|null (numeric(10,3) trafega como string), NUNCA number.
 */

export type PersistImportInput = {
  recipe: ImportedRecipe
  ownerId: string
  sourceUrl: string
}

export type PersistImportResult = {
  recipeId: string
  visibility: 'private'
}

export async function persistImport(input: PersistImportInput): Promise<PersistImportResult> {
  const { recipe: r, ownerId, sourceUrl } = input

  return getDb().transaction(async (tx) => {
    const [createdRecipe] = await tx
      .insert(recipe)
      .values({
        origin: 'web_imported',
        visibility: 'private', // SEMPRE privada (ADR-0019: importada nunca é pública).
        // result_kind default 'success' (CHECK recipe_playful_private_chk satisfeito: não é playful).
        ownerId,
        originalLocale: r.originalLocale,
        // schema.org/Recipe não mapeia confiavelmente cozinha/categoria/restrições do nosso
        // vocabulário fechado — deixamos NULL/[] (defaults). A camada bilíngue/Busca segue normal.
        sourceUrl,
        sourceName: r.sourceName,
      })
      .returning({ id: recipe.id })

    // Slug por idioma (#229, ADR-0020 dec.4): congelado na criação, do título do locale de
    // origem; desambiguado contra os slugs já em uso no locale.
    const slug = await slugForNewTranslation(tx, { locale: r.originalLocale, title: r.titulo })

    await tx.insert(recipeTranslation).values({
      recipeId: createdRecipe.id,
      locale: r.originalLocale,
      titulo: r.titulo,
      descricao: r.descricao,
      passos: r.passos,
      notas: r.notas,
      slug,
      provenance: 'automatica_nao_revisada',
    })

    if (r.ingredientes.length > 0) {
      await tx.insert(recipeIngredient).values(
        r.ingredientes.map((item, index) => ({
          recipeId: createdRecipe.id,
          ingredientId: null,
          ordem: index,
          quantidade: item.quantidade, // string|null — NUNCA number
          unidade: item.unidade,
          rawText: item.rawText,
        })),
      )
    }

    return { recipeId: createdRecipe.id, visibility: 'private' as const }
  })
}
