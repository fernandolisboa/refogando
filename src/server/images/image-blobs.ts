import { recipeImage } from '@/db/schema'
import type { ImageStore } from '@/server/images/image-store'

/**
 * Blobs de uma linha `recipe_image` e a deleção best-effort deles. Lar ÚNICO do "apaga o blob se for
 * NOSSO e engole o erro": o reap do hard-delete (#146), o APAGAR da galeria (dono e catálogo), a
 * limpeza de uma tx que falhou depois do `put`, o par de derivados pela metade e o par descartado do
 * backfill passam todos por `deleteOrphanBlob(s)`. Avatar e foto da avaliação também (não são
 * `recipe_image`, mas são blobs nossos com a mesma regra de `store.owns`).
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
