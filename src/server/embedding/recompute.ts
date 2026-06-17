import { and, eq } from 'drizzle-orm'
import type { Database } from '@/db/client'
import { recipeTranslation, recipeEmbedding } from '@/db/schema'
import { getEmbedder } from '@/server/deps'

/**
 * Recompute (re-embedding) da camada semântica (issue #14, ADR-0008). Dono do efeito de
 * popular `recipe_embedding` a partir da Tradução CORRENTE, espelhando a separação
 * puro+efeito de `visibility.ts`. Endereçável por `(recipe_id, locale)` ISOLADO (não
 * batch — requisito de #23). FORA do caminho de leitura (o GET é read-only/anônimo,
 * ADR-0011; a Busca nunca recomputa on-read — colidiria com a degradação).
 */

/** Modelo gravado em `recipe_embedding.model` (AC6). Constante por ora; o cliente real
 * troca por ex. `text-embedding-3-small` numa PR separada. */
export const EMBEDDING_MODEL = 'fake-deterministic'

/**
 * Recompute de UMA linha de embedding `(recipe_id, locale)`. Lê a Tradução corrente,
 * embeda o texto (mesma coluna FTS: titulo + descricao), faz upsert do vetor + model e
 * limpa `stale` SÓ após sucesso. Se o embedder LANÇA, propaga ANTES do upsert e NÃO toca
 * `stale` (preserva o sinal pra retry).
 *
 * O vetor (number[]) vai pelo builder do Drizzle: o tipo de coluna `vector` serializa via
 * `mapToDriverValue` (JSON.stringify → literal pgvector `'[...]'`), então o array entra
 * direto (não precisa do bind-literal manual que o SQL cru do loader exige).
 */
export async function embedTranslation(
  db: Database,
  recipeId: string,
  locale: string,
): Promise<{ ok: boolean }> {
  const [tr] = await db
    .select({ titulo: recipeTranslation.titulo, descricao: recipeTranslation.descricao })
    .from(recipeTranslation)
    .where(and(eq(recipeTranslation.recipeId, recipeId), eq(recipeTranslation.locale, locale)))
  if (!tr) return { ok: false } // sem Tradução corrente: nada a embedar

  // Espelha a coluna FTS search_vector (titulo + descricao).
  const text = `${tr.titulo ?? ''} ${tr.descricao ?? ''}`.trim()
  const vector = await getEmbedder().embed(text) // LANÇA → propaga, stale intacto

  // Upsert: a linha pode não existir ainda (1º embedding) ou já existir (re-embed).
  // stale limpa SÓ aqui (após o embed bem-sucedido).
  await db
    .insert(recipeEmbedding)
    .values({ recipeId, locale, embedding: vector, model: EMBEDDING_MODEL, stale: false })
    .onConflictDoUpdate({
      target: [recipeEmbedding.recipeId, recipeEmbedding.locale],
      set: { embedding: vector, model: EMBEDDING_MODEL, stale: false },
    })
  return { ok: true }
}
