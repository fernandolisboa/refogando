import sharp from 'sharp'
import {
  IMAGE_INPUT_PIXEL_LIMIT,
  PIPELINE_TIMEOUT_SECONDS,
  classifyRasterInput,
} from '@/server/images/image-derivatives'

/**
 * Re-encode da FOTO ENVIADA PELO USUÁRIO, no servidor (#365/#588 na foto da avaliação; #596 no avatar e na
 * Imagem da receita). Os três destinos são o Blob PÚBLICO: a foto sai servida a qualquer um, então não pode
 * levar o EXIF/GPS do celular (a localização da cozinha). Fonte ÚNICA do pipeline; cada destino só escolhe o
 * seu `UserPhotoSpec`.
 *
 * O pipeline (movido de `/api/recipes/[id]/reviews`, onde nasceu):
 *  - FORMATO PELOS BYTES (#588): o `file.type` que o route confere é o DECLARADO pelo cliente, e o sharp
 *    decodifica pelo conteúdo — um SVG (ou GIF/TIFF/HEIF) rotulado `image/png` seria RENDERIZADO (SVG de ~1 KB
 *    com filtros custa dezenas de segundos de CPU). Então o `metadata()` (só lê o cabeçalho, sem renderizar)
 *    decide via `classifyRasterInput` (o MESMO gate dos derivados da Imagem da receita): só JPEG/PNG/WebP de UM
 *    quadro (GIF/WebP animado viraria só o 1º quadro, em silêncio) seguem. APNG passa (o sharp não reporta
 *    `pages` pra PNG) e é gravado só com o 1º quadro: limite aceito.
 *  - ANTI-DoS (F1): o cap de 2 MB de BYTES do route não limita PIXELS — um PNG ~0.74 MB muito compressível
 *    (ex.: 16000×16000 cor sólida) decodifica p/ ~1 GB RGBA e OOMa a função (1024 MB na Vercel).
 *    `limitInputPixels` (`IMAGE_INPUT_PIXEL_LIMIT`) faz o sharp LANÇAR em entrada > 24 MP (bomba de
 *    descompressão barrada; 24 MP é generoso p/ foto de celular legítima e o cliente já redimensiona).
 *  - `.rotate()` sem argumento assa a orientação EXIF nos pixels; o WebP sai SEM metadado (o sharp descarta
 *    EXIF/ICC/XMP sem `.withMetadata()`), então GPS/EXIF NÃO vazam e a foto continua de pé.
 *  - `.resize` com fit:inside + withoutEnlargement LIMITA a maior dimensão do blob GRAVADO (`maxSide`) mesmo
 *    com cliente hostil/burlado, sem ampliar imagem pequena.
 *  - `.timeout` (`PIPELINE_TIMEOUT_SECONDS`) é o teto de CPU. Os bytes são lidos UMA vez e reusados nas duas
 *    passadas do sharp.
 *
 * Sempre WebP: o cliente honesto já manda WebP (`resizeImage`), os derivados já classificam WebP como ok e a
 * edição imagem-a-imagem do Gemini aceita WebP como entrada (`inlineData.mimeType` vem do `contentType`
 * guardado). Manter o formato de origem exigiria um encoder e um descarte de metadado por formato.
 *
 * Nunca lança: bytes que o sharp não decodifica, formato fora da allowlist, imagem animada, entrada acima do
 * teto de pixels ou pipeline que estourou o tempo ⇒ `null`, que o route traduz em 400 `tipo_invalido`
 * (nunca 500/OOM).
 */

/** Teto da maior dimensão do blob gravado e qualidade do WebP. */
export type UserPhotoSpec = { readonly maxSide: number; readonly quality: number }

/** Foto da avaliação (#365): byte-idêntica ao pipeline que vivia no route. */
export const REVIEW_PHOTO_SPEC = { maxSide: 2048, quality: 82 } as const satisfies UserPhotoSpec

/**
 * Imagem da receita enviada pelo dono ou pelo Curador (#596). Qualidade mais alta que a da avaliação: o
 * `blob_url` é o ORIGINAL que a edição imagem-a-imagem do Gemini lê, e cada re-encode com perda soma.
 */
export const RECIPE_PHOTO_SPEC = { maxSide: 2048, quality: 90 } as const satisfies UserPhotoSpec

/** Avatar (#596): exibido no máximo em ~160 px CSS; 1024 px cobre DPR 3 com folga. */
export const AVATAR_PHOTO_SPEC = { maxSide: 1024, quality: 82 } as const satisfies UserPhotoSpec

/**
 * `metadata()` + `classifyRasterInput` e, se a entrada passar, rotate → resize (inside, sem ampliar) → WebP →
 * timeout. `null` = rejeitar (o route responde 400 `tipo_invalido`).
 */
export async function reencodeUserPhoto(
  data: Buffer,
  spec: UserPhotoSpec,
): Promise<{ data: Buffer; contentType: 'image/webp' } | null> {
  const input = { limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT }
  try {
    const meta = await sharp(data, input).metadata()
    if (classifyRasterInput(meta) !== 'ok') return null
    const clean = await sharp(data, input)
      .rotate()
      .resize({ width: spec.maxSide, height: spec.maxSide, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: spec.quality })
      .timeout({ seconds: PIPELINE_TIMEOUT_SECONDS })
      .toBuffer()
    return { data: clean, contentType: 'image/webp' }
  } catch {
    // Bytes que o sharp não decodifica (arquivo corrompido / não-imagem com type forjado), entrada acima do
    // limite de pixels (bomba de descompressão) OU pipeline que estourou o timeout.
    return null
  }
}
