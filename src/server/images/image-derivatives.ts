import sharp from 'sharp'
import type { ImageStore } from '@/server/images/image-store'
import { IMAGE_DETAIL_WIDTH, IMAGE_THUMB_WIDTH } from '@/domain/image-variants'

/**
 * Derivados WebP da Imagem da receita (achado I da auditoria de performance, migração 0077; ADR-0016,
 * atualização de 2026-10-14). O feed servia o PNG cheio do Gemini (~1,5 MB) num thumb de 128–144 px.
 * Aqui, a partir dos bytes do ORIGINAL, o sharp gera `detail` (~1280 px de largura, capa do detalhe) e
 * `thumb` (~400 px, cards) e os guarda no `ImageStore` ao lado do original, que NUNCA é tocado (a edição
 * imagem-a-imagem do Gemini, #285, lê o original; um "baixar original" futuro também).
 *
 * BEST-EFFORT, NUNCA LANÇA: falhar aqui não pode derrubar o upload nem a geração do usuário. Qualquer
 * erro (bytes que o sharp não decodifica, imagem acima do teto de pixels, Blob fora) loga UMA linha
 * `[imagens]` só com o nome do erro e devolve `null`: as colunas ficam NULL e a tela cai no original;
 * o backfill (`derivatives-backfill.ts`) tenta de novo depois. Os dois derivados andam juntos (CHECK
 * `recipe_image_derivatives_pair_chk`): se só um subir, ele é apagado e o par fica NULL.
 *
 * Duas etapas separadas para o caminho de escrita sobrepor CPU e rede: `renderImageDerivatives` (CPU, no
 * threadpool do libuv) começa junto com o `put` do original, e `storeImageDerivatives` sobe o resultado
 * só depois que o original foi guardado (se o original falhar, nada de derivado órfão).
 */

/** Bytes dos dois derivados, já em WebP. */
export type RenderedImageDerivatives = { thumb: Buffer; detail: Buffer }

/** URLs públicas dos dois derivados guardados (vão para `recipe_image.thumb_url`/`detail_url`). */
export type ImageDerivativeUrls = { thumbUrl: string; detailUrl: string }

/**
 * Teto de pixels da ENTRADA (anti bomba de descompressão), o mesmo da foto da avaliação: o upload aceita
 * até 2 MB, mas um PNG muito compressível pode decodificar para gigabytes. Acima disso o sharp lança e
 * a imagem fica sem derivado (o original segue servido, como antes da 0077).
 */
const LIMIT_INPUT_PIXELS = 24_000_000

/** Qualidade WebP dos derivados. Medida no handoff 69 (PNG de 1024–1536 px do tipo do Gemini). */
const WEBP_QUALITY = 80

/** Linha de log sem dado do usuário (só a etapa e o nome do erro), no estilo `[account-purge]`. */
function logFailure(stage: string, err: unknown): void {
  console.warn(`[imagens] derivados não gerados (${stage}): ${err instanceof Error ? err.name : 'erro'}`)
}

/**
 * Gera os dois derivados (lança em erro; use `renderImageDerivativesSafe` no caminho de escrita).
 * `.rotate()` sem argumento aplica a orientação EXIF antes de reduzir: o navegador mostra o original
 * já rotacionado pela EXIF, e o WebP sai sem metadado (o sharp não copia EXIF/ICC sem `withMetadata`),
 * então os pixels precisam vir rotacionados para a tela ficar igual. `withoutEnlargement`: um original
 * menor que a largura-alvo não é ampliado (o derivado fica do tamanho dele). Imagem ANIMADA (WebP/GIF
 * com mais de um quadro) não ganha derivado: o sharp pegaria só o primeiro quadro e a tela mudaria.
 */
export async function renderImageDerivatives(data: Buffer): Promise<RenderedImageDerivatives> {
  const meta = await sharp(data, { limitInputPixels: LIMIT_INPUT_PIXELS }).metadata()
  if ((meta.pages ?? 1) > 1) {
    const err = new Error('imagem animada: sem derivado')
    err.name = 'AnimatedImage'
    throw err
  }
  const base = sharp(data, { limitInputPixels: LIMIT_INPUT_PIXELS }).rotate()
  const toWidth = (width: number) =>
    base.clone().resize({ width, withoutEnlargement: true }).webp({ quality: WEBP_QUALITY }).toBuffer()
  const [detail, thumb] = await Promise.all([toWidth(IMAGE_DETAIL_WIDTH), toWidth(IMAGE_THUMB_WIDTH)])
  return { thumb, detail }
}

/** `renderImageDerivatives` que nunca rejeita: erro ⇒ log + `null`. */
export async function renderImageDerivativesSafe(data: Buffer): Promise<RenderedImageDerivatives | null> {
  try {
    return await renderImageDerivatives(data)
  } catch (err) {
    logFailure('sharp', err)
    return null
  }
}

/**
 * Sobe os dois derivados (em paralelo) e devolve as URLs. Nunca rejeita: `rendered` nulo ⇒ `null`;
 * falha de qualquer `put` ⇒ apaga o que subiu (best-effort) e devolve `null` (o par fica NULL).
 */
export async function storeImageDerivatives(
  store: ImageStore,
  rendered: RenderedImageDerivatives | null,
): Promise<ImageDerivativeUrls | null> {
  if (!rendered) return null
  const put = (data: Buffer, width: number) =>
    store.store({ data, contentType: 'image/webp', pathPrefix: `recipes/w${width}` })
  const [thumb, detail] = await Promise.allSettled([
    put(rendered.thumb, IMAGE_THUMB_WIDTH),
    put(rendered.detail, IMAGE_DETAIL_WIDTH),
  ])
  if (thumb.status === 'fulfilled' && detail.status === 'fulfilled') {
    return { thumbUrl: thumb.value.url, detailUrl: detail.value.url }
  }
  for (const r of [thumb, detail]) {
    if (r.status === 'fulfilled') await deleteBlobQuietly(store, r.value.url)
  }
  const failed = thumb.status === 'rejected' ? thumb : (detail as PromiseRejectedResult)
  logFailure('storage', failed.reason)
  return null
}

/** Atalho das duas etapas em sequência (o backfill: o original já está guardado). Nunca rejeita. */
export async function generateImageDerivatives(
  store: ImageStore,
  data: Buffer,
): Promise<ImageDerivativeUrls | null> {
  return storeImageDerivatives(store, await renderImageDerivativesSafe(data))
}

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

/** Apaga um blob NOSSO sem propagar erro (órfão tolerável, como `deleteOrphanBlob`). */
async function deleteBlobQuietly(store: ImageStore, url: string): Promise<void> {
  if (!store.owns(url)) return
  try {
    await store.delete(url)
  } catch {
    // órfão tolerável.
  }
}
