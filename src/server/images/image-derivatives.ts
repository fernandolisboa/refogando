import sharp from 'sharp'
import type { ImageStore } from '@/server/images/image-store'
import { deleteOrphanBlobs } from '@/server/images/image-blobs'
import { IMAGE_DETAIL_WIDTH, IMAGE_THUMB_WIDTH } from '@/domain/image-variants'

/**
 * Derivados WebP da Imagem da receita (achado I da auditoria de performance, migração 0077; ADR-0016,
 * atualização de 2026-10-14). O feed servia o PNG cheio do Gemini (~1,5 MB) num thumb de 128–144 px.
 * Aqui, a partir dos bytes do ORIGINAL, o sharp gera `detail` (~1280 px de largura, capa do detalhe) e
 * `thumb` (~400 px, cards) e os guarda no `ImageStore` ao lado do original, que NUNCA é tocado (a edição
 * imagem-a-imagem do Gemini, #285, lê o original; um "baixar original" futuro também).
 *
 * BEST-EFFORT, NUNCA LANÇA: falhar aqui não pode derrubar o upload nem a geração do usuário. Qualquer
 * erro (bytes que o sharp não decodifica, formato fora de JPEG/PNG/WebP, imagem animada, acima do teto
 * de pixels ou do tempo, Blob fora) loga UMA linha `[imagens]` só com o nome do erro (ou o motivo) e
 * devolve `null`: as colunas ficam NULL e a tela cai no original; o backfill
 * (`derivatives-backfill.ts`) tenta de novo depois. Os dois derivados andam juntos (CHECK
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
 * Teto de pixels da ENTRADA (anti bomba de descompressão), compartilhado com a foto da avaliação
 * (`/api/recipes/[id]/reviews`): o upload aceita até 2 MB, mas um PNG muito compressível pode
 * decodificar para gigabytes. Acima disso o sharp lança e a imagem fica sem derivado (o original segue
 * servido, como antes da 0077).
 */
export const IMAGE_INPUT_PIXEL_LIMIT = 24_000_000

/**
 * Formatos que ganham derivado. O route do upload só confere o `file.type` DECLARADO pelo cliente, e o
 * sharp decodifica pelos BYTES: um SVG (ou TIFF/GIF/HEIF) rotulado `image/png` seria renderizado. Um SVG
 * de 1,3 KB com `feTurbulence`/`feGaussianBlur` custou ~30 s de CPU. Então o formato vem do `metadata()`
 * (que só lê o cabeçalho, sem renderizar) e só JPEG, PNG e WebP seguem; o resto fica sem derivado e a
 * tela usa o original, exatamente como antes da 0077 (o upload em si não muda: não rejeitamos aqui).
 * Exportado: a foto da avaliação (`/api/recipes/[id]/reviews`, #588) usa a MESMA allowlist pelos bytes, mas
 * lá rejeita (400 `tipo_invalido`), porque a foto é re-encodada no upload.
 */
export const DERIVABLE_FORMATS: ReadonlySet<string> = new Set(['jpeg', 'png', 'webp'])

/**
 * Teto de CPU de cada pipeline do sharp (defesa extra além do formato e do teto de pixels). Compartilhado
 * com o re-encode da foto da avaliação (#588).
 */
export const PIPELINE_TIMEOUT_SECONDS = 10

/** Qualidade WebP dos derivados. Medida no handoff 69 (PNG de 1024–1536 px do tipo do Gemini). */
const WEBP_QUALITY = 80

/** Entrada que, de propósito, não ganha derivado (não é falha do sharp): o motivo vai para o log. */
class DerivativeSkipped extends Error {
  override name = 'DerivativeSkipped'
  constructor(readonly reason: string) {
    super(`sem derivado: ${reason}`)
  }
}

/**
 * Linha de log sem dado do usuário (só a etapa e o nome do erro, ou o motivo de não gerar, que é um
 * formato do sharp ou "animada"), no estilo `[account-purge]`.
 */
function logFailure(stage: string, err: unknown): void {
  const why = err instanceof DerivativeSkipped ? err.reason : err instanceof Error ? err.name : 'erro'
  console.warn(`[imagens] derivados não gerados (${stage}): ${why}`)
}

/**
 * Gera os dois derivados (lança em erro; use `renderImageDerivativesSafe` no caminho de escrita).
 *
 * - Lê o `metadata()` PRIMEIRO: formato fora de JPEG/PNG/WebP (`DERIVABLE_FORMATS`) ou imagem ANIMADA
 *   (WebP com mais de um quadro: o sharp pegaria só o primeiro e a tela mudaria) ⇒ sem derivado.
 * - `.rotate()` sem argumento aplica a orientação EXIF antes de reduzir: o navegador mostra o original
 *   já rotacionado pela EXIF, e o WebP sai sem metadado (o sharp não copia EXIF/ICC sem `withMetadata`),
 *   então os pixels precisam vir rotacionados para a tela ficar igual.
 * - `withoutEnlargement`: um original menor que a largura-alvo não é ampliado.
 * - Os dois renders rodam um DEPOIS do outro, cada um decodificando o original: em paralelo (`clone()`)
 *   eram duas decodificações cheias ao mesmo tempo (~87 MB acima da base num PNG de 24 MP). Derivar o
 *   thumb do detail economizaria uma decodificação, mas o arredondamento da altura poderia mudar em 1 px
 *   e o thumb sairia de um WebP já com perda. A latência extra fica escondida atrás do `put` do original.
 */
export async function renderImageDerivatives(data: Buffer): Promise<RenderedImageDerivatives> {
  const input = { limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT }
  const meta = await sharp(data, input).metadata()
  if (!meta.format || !DERIVABLE_FORMATS.has(meta.format)) {
    throw new DerivativeSkipped(`formato ${meta.format ?? 'desconhecido'}`)
  }
  if ((meta.pages ?? 1) > 1) throw new DerivativeSkipped('animada')
  const toWidth = (width: number) =>
    sharp(data, input)
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .timeout({ seconds: PIPELINE_TIMEOUT_SECONDS })
      .toBuffer()
  const detail = await toWidth(IMAGE_DETAIL_WIDTH)
  const thumb = await toWidth(IMAGE_THUMB_WIDTH)
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
  await deleteOrphanBlobs(
    store,
    [thumb, detail].flatMap((r) => (r.status === 'fulfilled' ? [r.value.url] : [])),
  )
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
