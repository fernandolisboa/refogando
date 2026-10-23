import { beforeAll, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import {
  AVATAR_PHOTO_SPEC,
  RECIPE_PHOTO_SPEC,
  REVIEW_PHOTO_SPEC,
  reencodeUserPhoto,
} from '@/server/images/user-photo'
import { IMAGE_INPUT_PIXEL_LIMIT, PIPELINE_TIMEOUT_SECONDS } from '@/server/images/image-derivatives'

/**
 * Re-encode da foto do usuário (#596; antes só a da avaliação, #365/#588). Sharp de verdade, sem banco nem
 * rede. Cobre: EXIF/GPS/ICC some e a orientação é assada nos pixels; `maxSide` de cada spec e sem ampliar;
 * a spec da avaliação sai BYTE-IDÊNTICA ao pipeline que vivia no route; GIF, WebP animado, SVG, lixo e bomba
 * de pixels ⇒ `null` (o route responde 400 `tipo_invalido`).
 */

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#c86432' } })

/** Ponteiro para o IFD de GPS (tag 0x8825) no EXIF little-endian (`II`) que o libvips escreve. */
const hasGpsIfd = (exif: Buffer) => exif.includes(Buffer.from([0x25, 0x88]))

let EXIF_JPEG: Buffer

beforeAll(async () => {
  // 200×100 com Orientation=6 (90° horário: o navegador exibe 100×200), fabricante, GPS e um perfil ICC.
  EXIF_JPEG = await solid(200, 100)
    .jpeg()
    .withMetadata({
      orientation: 6,
      exif: {
        IFD0: { Make: 'CelularDaCozinha', Copyright: 'Fulana' },
        IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 33/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '46/1 38/1 0/1' },
      },
    })
    .withIccProfile('p3')
    .toBuffer()
})

describe('reencodeUserPhoto — metadados', () => {
  it('JPEG com EXIF, GPS, orientação e ICC ⇒ WebP sem EXIF/ICC/XMP, com a orientação assada (largura e altura trocadas)', async () => {
    const before = await sharp(EXIF_JPEG).metadata()
    expect(before.exif).toBeDefined()
    expect(hasGpsIfd(before.exif!)).toBe(true)
    expect(before.exif!.toString('latin1')).toContain('CelularDaCozinha')
    expect(before.icc).toBeDefined()
    expect(before.orientation).toBe(6)

    for (const spec of [REVIEW_PHOTO_SPEC, RECIPE_PHOTO_SPEC, AVATAR_PHOTO_SPEC]) {
      const out = await reencodeUserPhoto(EXIF_JPEG, spec)
      expect(out?.contentType).toBe('image/webp')
      const after = await sharp(out!.data).metadata()
      expect(after.format).toBe('webp')
      expect(after.exif).toBeUndefined()
      expect(after.icc).toBeUndefined()
      expect(after.xmp).toBeUndefined()
      expect(after.orientation).toBeUndefined()
      expect([after.width, after.height]).toEqual([100, 200])
      expect(out!.data.toString('latin1')).not.toContain('CelularDaCozinha')
    }
  })
})

describe('reencodeUserPhoto — dimensões', () => {
  it('respeita o `maxSide` de cada spec, mantendo a proporção', async () => {
    const big = await solid(3000, 1500).png().toBuffer()
    const recipeOut = await sharp((await reencodeUserPhoto(big, RECIPE_PHOTO_SPEC))!.data).metadata()
    expect([recipeOut.width, recipeOut.height]).toEqual([2048, 1024])
    const avatarOut = await sharp((await reencodeUserPhoto(big, AVATAR_PHOTO_SPEC))!.data).metadata()
    expect([avatarOut.width, avatarOut.height]).toEqual([1024, 512])
    const tall = await solid(800, 1600).jpeg().toBuffer()
    const tallOut = await sharp((await reencodeUserPhoto(tall, AVATAR_PHOTO_SPEC))!.data).metadata()
    expect([tallOut.width, tallOut.height]).toEqual([512, 1024])
  })

  it('não amplia imagem pequena', async () => {
    const small = await solid(300, 200).webp().toBuffer()
    for (const spec of [REVIEW_PHOTO_SPEC, RECIPE_PHOTO_SPEC, AVATAR_PHOTO_SPEC]) {
      const out = await sharp((await reencodeUserPhoto(small, spec))!.data).metadata()
      expect([out.width, out.height]).toEqual([300, 200])
    }
  })
})

describe('reencodeUserPhoto — spec da avaliação', () => {
  it('sai byte-idêntica ao pipeline que vivia em /api/recipes/[id]/reviews', async () => {
    const input = { limitInputPixels: IMAGE_INPUT_PIXEL_LIMIT }
    for (const data of [EXIF_JPEG, await solid(2500, 900).png().toBuffer()]) {
      const legacy = await sharp(data, input)
        .rotate()
        .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .timeout({ seconds: PIPELINE_TIMEOUT_SECONDS })
        .toBuffer()
      const out = await reencodeUserPhoto(data, REVIEW_PHOTO_SPEC)
      expect(out!.data.equals(legacy)).toBe(true)
    }
  })
})

describe('reencodeUserPhoto — recusa (⇒ 400 tipo_invalido no route)', () => {
  it('GIF e WebP animado ⇒ null', async () => {
    const gif = await solid(40, 20).gif().toBuffer()
    const white = await sharp({ create: { width: 20, height: 40, channels: 4, background: '#fff' } }).png().toBuffer()
    const black = await sharp({ create: { width: 20, height: 40, channels: 4, background: '#000' } }).png().toBuffer()
    const animated = await sharp([white, black], { join: { animated: true } }).webp().toBuffer()
    expect((await sharp(animated).metadata()).pages).toBe(2)
    expect(await reencodeUserPhoto(gif, RECIPE_PHOTO_SPEC)).toBeNull()
    expect(await reencodeUserPhoto(animated, RECIPE_PHOTO_SPEC)).toBeNull()
  })

  it('SVG com filtros caros ⇒ null sem renderizar (rápido)', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="4800" height="4800">' +
        '<filter id="f"><feTurbulence baseFrequency="0.9" numOctaves="10"/><feGaussianBlur stdDeviation="40"/></filter>' +
        '<rect width="100%" height="100%" filter="url(#f)"/></svg>',
    )
    const t0 = performance.now()
    expect(await reencodeUserPhoto(svg, AVATAR_PHOTO_SPEC)).toBeNull()
    expect(performance.now() - t0).toBeLessThan(1_000)
  })

  it('bytes que não são imagem ⇒ null', async () => {
    expect(await reencodeUserPhoto(Buffer.from([1, 2, 3, 4]), REVIEW_PHOTO_SPEC)).toBeNull()
    expect(await reencodeUserPhoto(Buffer.alloc(0), REVIEW_PHOTO_SPEC)).toBeNull()
  })

  it('bomba de pixels acima de 24 MP (PNG cor sólida, poucos bytes) ⇒ null', async () => {
    const bomb = await solid(5000, 5000).png().toBuffer()
    expect(bomb.length).toBeLessThan(2 * 1024 * 1024)
    expect(await reencodeUserPhoto(bomb, RECIPE_PHOTO_SPEC)).toBeNull()
  })
})
