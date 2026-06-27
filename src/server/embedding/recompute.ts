import { and, eq, isNull, or, sql } from 'drizzle-orm'
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

// Nome do modelo na API + VERSÃO da geometria gravada em `recipe_embedding.model` — fonte única no
// SEAM (`embedder.ts`); re-exportados aqui pelos consumidores históricos. #119 plugou o Gemini real;
// #2 passou a gravar `EMBEDDING_VERSION` (geometria, não só o nome) p/ o reembed ser self-healing.
export { EMBEDDING_MODEL, EMBEDDING_VERSION } from '@/server/embedding/embedder'
import { EMBEDDING_VERSION } from '@/server/embedding/embedder'

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
  // DOCUMENTO indexado: `RETRIEVAL_DOCUMENT` (par assimétrico com `RETRIEVAL_QUERY` na Busca).
  const vector = await getEmbedder().embed(text, 'RETRIEVAL_DOCUMENT') // LANÇA → propaga, stale intacto

  // Upsert: a linha pode não existir ainda (1º embedding) ou já existir (re-embed).
  // stale limpa SÓ aqui (após o embed bem-sucedido).
  await db
    .insert(recipeEmbedding)
    .values({ recipeId, locale, embedding: vector, model: EMBEDDING_VERSION, stale: false })
    .onConflictDoUpdate({
      target: [recipeEmbedding.recipeId, recipeEmbedding.locale],
      set: { embedding: vector, model: EMBEDDING_VERSION, stale: false },
    })
  return { ok: true }
}

/**
 * Predicado "esta Tradução PRECISA de embedding" (#119): não há linha `recipe_embedding` para
 * `(recipe_id, locale)`, OU há mas com vetor NULL (dormente), OU está `stale` (conteúdo mudou), OU o
 * vetor é de uma GEOMETRIA ANTIGA (`model <> EMBEDDING_VERSION` — #2). É a fonte tanto dos CANDIDATOS
 * do backfill quanto da contagem de RESTANTES — definido uma vez. Usa o LEFT JOIN externo
 * `recipe_embedding`, então `isNull(recipeEmbedding.recipeId)` casa o "sem linha".
 *
 * A 4ª cláusula torna o reembed SELF-HEALING: ao bumpar `EMBEDDING_VERSION` (ex.: ao adicionar
 * `taskType`), o deploy passa a contar as linhas antigas como candidatas — o backfill (e o recompute
 * on-write) as migra, sem `UPDATE ... SET stale` manual. `IS DISTINCT FROM` (não `<>`) trata `model`
 * NULL como diferente (linha antiga sem tag também é candidata).
 */
const NEEDS_EMBEDDING = or(
  isNull(recipeEmbedding.recipeId),
  isNull(recipeEmbedding.embedding),
  eq(recipeEmbedding.stale, true),
  sql`${recipeEmbedding.model} IS DISTINCT FROM ${EMBEDDING_VERSION}`,
)

/**
 * BACKFILL (#119) — recomputa, em LOTE CAPADO, as Traduções sem embedding válido. Para receitas que
 * nasceram antes do pipeline de embedding-na-criação (ou cujo embed best-effort falhou). Processa
 * sequencialmente; PARA no 1º erro do embedder (ex. 429) devolvendo o que já fez + a causa, pra o
 * admin retomar depois sem perder progresso (cada embed é um upsert idempotente). Devolve também
 * quantos AINDA faltam (após o lote) — o admin chama de novo até `remaining === 0`.
 *
 * Capado de propósito (serverless tem teto de tempo): o route limita `limit` a uma faixa segura.
 */
export async function recomputeMissingEmbeddings(
  db: Database,
  limit: number,
): Promise<{ recomputed: number; remaining: number; error?: string }> {
  const candidates = await db
    .select({ recipeId: recipeTranslation.recipeId, locale: recipeTranslation.locale })
    .from(recipeTranslation)
    .leftJoin(
      recipeEmbedding,
      and(
        eq(recipeEmbedding.recipeId, recipeTranslation.recipeId),
        eq(recipeEmbedding.locale, recipeTranslation.locale),
      ),
    )
    .where(NEEDS_EMBEDDING)
    .limit(limit)

  let recomputed = 0
  let error: string | undefined
  for (const c of candidates) {
    try {
      const r = await embedTranslation(db, c.recipeId, c.locale)
      if (r.ok) recomputed++
    } catch {
      // Embedder caiu (sem key / 429 / rede): para o lote e reporta — o progresso já feito persiste.
      // CÓDIGO estável, NÃO a mensagem crua: o corpo de erro do Gemini é SERVER-ONLY (espelha o
      // contrato do RealEmbedder) — nunca volta ao cliente, nem ao admin. A UI mapeia o código.
      error = 'embedder_indisponivel'
      break
    }
  }

  const [rem] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recipeTranslation)
    .leftJoin(
      recipeEmbedding,
      and(
        eq(recipeEmbedding.recipeId, recipeTranslation.recipeId),
        eq(recipeEmbedding.locale, recipeTranslation.locale),
      ),
    )
    .where(NEEDS_EMBEDDING)

  return { recomputed, remaining: rem?.n ?? 0, ...(error ? { error } : {}) }
}
