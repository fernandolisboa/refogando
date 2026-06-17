import type { Database } from '@/db/client'
import { recipe, recipeTranslation, recipeIngredient } from '@/db/schema'
import type { Cozinha, Categoria, Restricao, Unidade } from '@/domain/vocabulary'

/**
 * Criação de Receita de CATÁLOGO editorial pelo Curador (issue #19, AC1).
 *
 * Caminho NOVO (NÃO reusa `persistGeneration`, cujo `PersistOrigin` EXCLUI 'catalog'
 * de propósito — catálogo editorial não é um episódio de geração). Reusa só o TEMPLATE
 * ESTRUTURAL da tx de `persistGeneration` (pai antes de filhos, numa transação) com as
 * decisões congeladas de #19:
 *  - `origin='catalog'` no INSERT (origin é imutável via trigger BEFORE UPDATE — o INSERT
 *    NUNCA é gateado, só o UPDATE de origin; verificado no micro-spike).
 *  - `ownerId=null` (catálogo/sistema — ADR-0011) ⇒ passa o gate de LEITURA por owner-NULL.
 *  - `visibility='private'` (default de banco; NÃO setar 'public' — owner-NULL já abre a
 *    leitura).
 *  - tradução do `originalLocale` com `provenance='escrita_por_pessoa'` (conteúdo editorial
 *    humano — o oposto de `automatica_nao_revisada` da geração).
 *  - itens com `ingredientId=null` (resolução Item→canônico é AC2, endpoint separado);
 *    `quantidade` string|null (numeric(10,3) trafega como string, NUNCA number).
 *
 * NÃO seta embedding (nasce ausente/dormente, como em `persistGeneration`); NÃO chama
 * `applyEdit` (o create não marca stale — não há tradução prévia).
 */

export type CreateCatalogRecipeInput = {
  originalLocale: string // já canonicalizado pela borda
  titulo: string
  descricao: string | null
  passos: string[] | null
  notas: string | null
  cozinha: Cozinha | null
  categoria: Categoria | null
  restricoes: Restricao[]
  porcoes: number | null
  dificuldade: number | null
  ingredientes: {
    rawText: string | null
    quantidade: string | null // numeric(10,3) ⇒ string|null, NUNCA number
    unidade: Unidade | null
  }[]
}

export async function createCatalogRecipe(
  db: Database,
  input: CreateCatalogRecipeInput,
): Promise<{ recipeId: string }> {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(recipe)
      .values({
        origin: 'catalog',
        visibility: 'private', // owner-NULL abre a leitura; NÃO 'public'
        ownerId: null,
        originalLocale: input.originalLocale,
        cozinha: input.cozinha,
        categoria: input.categoria,
        restricoes: input.restricoes,
        porcoes: input.porcoes,
        dificuldade: input.dificuldade,
        // resultKind/schemaVersion: default de banco.
      })
      .returning({ id: recipe.id })

    await tx.insert(recipeTranslation).values({
      recipeId: r.id,
      locale: input.originalLocale,
      titulo: input.titulo,
      descricao: input.descricao,
      passos: input.passos,
      notas: input.notas,
      provenance: 'escrita_por_pessoa',
    })

    if (input.ingredientes.length > 0) {
      await tx.insert(recipeIngredient).values(
        input.ingredientes.map((it, i) => ({
          recipeId: r.id,
          ingredientId: null,
          ordem: i,
          quantidade: it.quantidade, // string|null
          unidade: it.unidade,
          rawText: it.rawText,
        })),
      )
    }

    return { recipeId: r.id }
  })
}
