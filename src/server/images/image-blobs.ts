import { recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'

/**
 * Blobs de uma linha `recipe_image` e a deleção best-effort deles. Lar ÚNICO do "apaga o blob se for
 * NOSSO e engole o erro": o reap do hard-delete (#146), o APAGAR da galeria (dono e catálogo), a
 * limpeza de uma tx que falhou depois do `put`, o par de derivados pela metade e o par descartado do
 * backfill passam todos por `deleteOrphanBlob(s)`. Avatar e foto da avaliação também (não são
 * `recipe_image`, mas são blobs nossos com a mesma regra de `store.owns`). A eliminação da conta e a
 * varredura do conteúdo privado (#473), que apagam muitos de uma vez, usam `deleteOrphanBlobsConcurrently`.
 */

/**
 * Os blobs de uma linha `recipe_image`: o original e os derivados WebP (achado I, 0077). Quem APAGA a
 * linha lê os três (SELECT/RETURNING) e apaga todos depois do commit (`imageRowBlobUrls`).
 */
export const IMAGE_BLOB_COLS = {
  blobUrl: recipeImage.blobUrl,
  thumbUrl: recipeImage.thumbUrl,
  detailUrl: recipeImage.detailUrl,
} as const

/**
 * Todos os blobs de uma linha `recipe_image`: o original e os derivados presentes. Quem apaga a linha
 * (APAGAR da galeria, reap do hard-delete) apaga os três; senão os derivados ficariam órfãos no Blob.
 */
export function imageRowBlobUrls(row: {
  blobUrl: string
  thumbUrl?: string | null
  detailUrl?: string | null
}): string[] {
  return [row.blobUrl, row.thumbUrl, row.detailUrl].filter(
    (u): u is string => typeof u === 'string' && u.length > 0,
  )
}

/** Apaga o blob órfão se houver E se for NOSSO (no-op silencioso para URL estrangeira/ausente). */
export async function deleteOrphanBlob(store: ImageStore, blobUrl: string | null | undefined): Promise<void> {
  if (!blobUrl || !store.owns(blobUrl)) return
  try {
    await store.delete(blobUrl)
  } catch {
    // Órfão tolerável: a Receita já foi repontada/limpa; não propagamos a falha de limpeza.
  }
}

/** `deleteOrphanBlob` para vários blobs (ex.: os de uma linha, `imageRowBlobUrls`). */
export async function deleteOrphanBlobs(store: ImageStore, blobUrls: ReadonlyArray<string>): Promise<void> {
  for (const url of blobUrls) await deleteOrphanBlob(store, url)
}

/** Quantos blobs a eliminação apaga em paralelo depois do commit (centenas de imagens não cabem em série). */
export const BLOB_DELETE_CONCURRENCY = 8

/**
 * `deleteOrphanBlob` para MUITOS blobs, com no máximo `concurrency` deleções em voo (eliminação da conta e
 * varredura do conteúdo privado, #473). Deduplica, pula vazio e URL estrangeira, e NUNCA lança: `owns` e
 * `delete` ficam dentro do try (um `owns` que lança depois do commit não pode virar 500 — o banco já está
 * limpo). Devolve quantos blobs NOSSOS foram apagados de fato.
 */
export async function deleteOrphanBlobsConcurrently(
  store: ImageStore,
  urls: ReadonlyArray<string | null | undefined>,
  concurrency = BLOB_DELETE_CONCURRENCY,
): Promise<number> {
  const queue = [...new Set(urls.filter((u): u is string => typeof u === 'string' && u.length > 0))]
  let next = 0
  let deleted = 0
  async function worker(): Promise<void> {
    while (next < queue.length) {
      const url = queue[next++]
      try {
        if (!store.owns(url)) continue
        await store.delete(url)
        deleted += 1
      } catch {
        // Órfão tolerável: a linha já saiu no commit; o blob sem ponteiro não aponta mais para ninguém.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker))
  return deleted
}
