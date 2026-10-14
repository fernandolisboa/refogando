import { describe, it, expect } from 'vitest'
import {
  buildImageSrcSet,
  IMAGE_DETAIL_WIDTH,
  IMAGE_SIZES,
  IMAGE_THUMB_WIDTH,
} from '@/domain/image-variants'

/**
 * `srcset`/`sizes` dos derivados WebP (achado I, migração 0077). Duas frentes:
 *  - `buildImageSrcSet`: só com os DOIS derivados (um só faria a capa do detalhe sair com 400 px),
 *    URLs que não podem entrar num `srcset` (espaço/vírgula, relativa) ⇒ sem `srcset` (fica o original).
 *  - A ESCOLHA do navegador: um avaliador mínimo de `sizes` (media `min-width` + px/rem/`calc(vw - x)`)
 *    e a regra CONSERVADORA de escolha (a do Safari e do texto da spec: o menor candidato com densidade
 *    ≥ DPR; sem nenhum, o maior). O Chrome escolhe igual ou menor (média geométrica entre vizinhos), então
 *    onde este teste dá o thumb, todo navegador dá o thumb.
 */

const THUMB = 'https://abc.public.blob.vercel-storage.com/recipes/w400/t.webp'
const DETAIL = 'https://abc.public.blob.vercel-storage.com/recipes/w1280/d.webp'
const REM = 16

/** Comprimento CSS do `sizes` em px para uma viewport (só as formas que `IMAGE_SIZES` usa). */
function lengthPx(value: string, vw: number): number {
  const v = value.trim()
  const calc = /^calc\((\d+(?:\.\d+)?)vw\s*-\s*(\d+(?:\.\d+)?)(px|rem)\)$/.exec(v)
  if (calc) return (Number(calc[1]) * vw) / 100 - Number(calc[2]) * (calc[3] === 'rem' ? REM : 1)
  const plain = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(v)
  if (plain) return Number(plain[1]) * (plain[2] === 'rem' ? REM : 1)
  throw new Error(`comprimento não suportado pelo avaliador do teste: ${v}`)
}

/** Largura do slot que o navegador tira de `sizes` (primeira condição que casa; a última é o default). */
function slotPx(sizes: string, vw: number): number {
  for (const entry of sizes.split(',')) {
    const m = /^\s*\(min-width:\s*(\d+(?:\.\d+)?)(px|rem)\)\s+(.+)$/.exec(entry)
    if (!m) return lengthPx(entry, vw)
    const min = Number(m[1]) * (m[2] === 'rem' ? REM : 1)
    if (vw >= min) return lengthPx(m[3], vw)
  }
  throw new Error('sizes sem default')
}

/** Candidato escolhido (regra conservadora): menor densidade ≥ DPR; senão o maior. */
function pick(srcset: string, sizes: string, vw: number, dpr: number): string {
  const slot = slotPx(sizes, vw)
  const candidates = srcset
    .split(',')
    .map((c) => c.trim().split(/\s+/))
    .map(([url, w]) => ({ url, density: Number(w.replace('w', '')) / slot }))
    .sort((a, b) => a.density - b.density)
  return (candidates.find((c) => c.density >= dpr) ?? candidates[candidates.length - 1]).url
}

describe('buildImageSrcSet', () => {
  it('com os dois derivados: thumb 400w e detail 1280w', () => {
    expect(buildImageSrcSet(THUMB, DETAIL)).toBe(`${THUMB} ${IMAGE_THUMB_WIDTH}w, ${DETAIL} ${IMAGE_DETAIL_WIDTH}w`)
    expect(IMAGE_THUMB_WIDTH).toBe(400)
    expect(IMAGE_DETAIL_WIDTH).toBe(1280)
  })

  it('sem um dos dois (ou nenhum) ⇒ undefined: a <img> fica só com o original', () => {
    expect(buildImageSrcSet(THUMB, null)).toBeUndefined()
    expect(buildImageSrcSet(null, DETAIL)).toBeUndefined()
    expect(buildImageSrcSet(undefined, undefined)).toBeUndefined()
    expect(buildImageSrcSet('', DETAIL)).toBeUndefined()
  })

  it('URL que quebraria o srcset (espaço, vírgula, relativa, outro esquema) ⇒ undefined', () => {
    expect(buildImageSrcSet('https://x.com/a b.webp', DETAIL)).toBeUndefined()
    expect(buildImageSrcSet(THUMB, 'https://x.com/a,b.webp')).toBeUndefined()
    expect(buildImageSrcSet('/recipes/t.webp', DETAIL)).toBeUndefined()
    expect(buildImageSrcSet('javascript:alert(1)', DETAIL)).toBeUndefined()
  })
})

describe('escolha do candidato pelo navegador (sizes de cada superfície)', () => {
  const srcset = buildImageSrcSet(THUMB, DETAIL)!

  it('card do feed/Busca (lista, 128–144 px): thumb em celular até DPR 3 e em desktop até DPR 2', () => {
    for (const vw of [320, 375, 390, 430]) {
      for (const dpr of [1, 2, 3]) expect(pick(srcset, IMAGE_SIZES.resultList, vw, dpr)).toBe(THUMB)
    }
    for (const vw of [768, 1024, 1440, 1920]) {
      for (const dpr of [1, 2]) expect(pick(srcset, IMAGE_SIZES.resultList, vw, dpr)).toBe(THUMB)
    }
    expect(slotPx(IMAGE_SIZES.resultList, 375)).toBe(128)
    expect(slotPx(IMAGE_SIZES.resultList, 1440)).toBe(144)
  })

  it('miniaturas (Cardápio, Despensa, cozinheiro, galeria): sempre o thumb', () => {
    for (const sizes of [IMAGE_SIZES.smallThumb, IMAGE_SIZES.galleryThumb]) {
      for (const vw of [375, 1440]) {
        for (const dpr of [1, 2, 3]) expect(pick(srcset, sizes, vw, dpr)).toBe(THUMB)
      }
    }
  })

  it('capa do detalhe: o derivado de 1280 px em tablet/desktop e em celular de DPR 2–3', () => {
    for (const vw of [768, 1440]) {
      for (const dpr of [1, 2, 3]) expect(pick(srcset, IMAGE_SIZES.detailHero, vw, dpr)).toBe(DETAIL)
    }
    for (const dpr of [2, 3]) expect(pick(srcset, IMAGE_SIZES.detailHero, 375, dpr)).toBe(DETAIL)
    // Celular de DPR 1 (raro) com slot de 343 px: os 400 px do thumb já bastam (densidade ≥ 1).
    expect(pick(srcset, IMAGE_SIZES.detailHero, 375, 1)).toBe(THUMB)
    expect(slotPx(IMAGE_SIZES.detailHero, 1440)).toBe(784)
    expect(slotPx(IMAGE_SIZES.detailHero, 375)).toBe(343)
  })

  it('card de Minhas criações/Salvos (~300–350 px): thumb só em DPR 1, detail acima (sem borrar)', () => {
    expect(pick(srcset, IMAGE_SIZES.listCard, 1440, 1)).toBe(THUMB)
    expect(pick(srcset, IMAGE_SIZES.listCard, 1440, 2)).toBe(DETAIL)
    expect(pick(srcset, IMAGE_SIZES.listCard, 375, 3)).toBe(DETAIL)
  })

  it('grade das semelhantes (4 colunas no desktop): thumb em DPR 1–2 no desktop', () => {
    for (const dpr of [1, 2]) expect(pick(srcset, IMAGE_SIZES.resultGrid, 1440, dpr)).toBe(THUMB)
    expect(slotPx(IMAGE_SIZES.resultGrid, 1440)).toBe(184)
  })
})
