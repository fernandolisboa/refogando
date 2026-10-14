import { describe, it, expect } from 'vitest'
import {
  buildImageSrcSet,
  IMAGE_DETAIL_WIDTH,
  IMAGE_SLOTS,
  IMAGE_THUMB_WIDTH,
  imageSrcSetProps,
  type ImageSlot,
} from '@/domain/image-variants'

/**
 * `srcset`/`sizes` dos derivados WebP (achado I, migração 0077). Três frentes:
 *  - `buildImageSrcSet`: só com a imagem exibida e os DOIS derivados (um só faria a capa do detalhe sair
 *    com 400 px); URLs que não podem entrar num `srcset` (espaço/vírgula, relativa) ⇒ sem `srcset`.
 *  - `imageSrcSetProps`: slot grande não oferece o thumb.
 *  - A ESCOLHA do navegador: um avaliador mínimo de `sizes` (media `min-width` + px/rem/`calc(vw - x)`)
 *    e DUAS regras de escolha, porque a spec deixa a escolha ao navegador: a "menor densidade ≥ DPR" e
 *    a do Chrome (média geométrica entre candidatos vizinhos, que PODE escolher o candidato de densidade
 *    menor que o DPR). O critério: em DPR ≤ 2, nenhuma das duas escolhe um candidato abaixo do necessário
 *    quando há um maior. Por isso os slots que passam de 200 px CSS ficam sem o thumb.
 */

const ORIGINAL = 'https://abc.public.blob.vercel-storage.com/recipes/o.png'
const THUMB = 'https://abc.public.blob.vercel-storage.com/recipes/w400/t.webp'
const DETAIL = 'https://abc.public.blob.vercel-storage.com/recipes/w1280/d.webp'
const REM = 16
const SLOTS = Object.keys(IMAGE_SLOTS) as ImageSlot[]
/** Viewports de 320 a 2560 px (passo de 1 px perto das quebras de 40rem e 52rem). */
const VIEWPORTS = Array.from({ length: 2241 }, (_, i) => 320 + i)

const build = (thumbUrl: string | null, detailUrl: string | null, original: string | null = ORIGINAL) =>
  buildImageSrcSet({ original, thumbUrl, detailUrl })

/** Comprimento CSS do `sizes` em px para uma viewport (só as formas que `IMAGE_SLOTS` usa). */
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

type Candidate = { url: string; density: number }

function candidates(srcset: string, slot: number): Candidate[] {
  return srcset
    .split(',')
    .map((c) => c.trim().split(/\s+/))
    .map(([url, w]) => ({ url, density: Number(w.replace('w', '')) / slot }))
    .sort((a, b) => a.density - b.density)
}

/** Regra "menor candidato com densidade ≥ DPR; sem nenhum, o maior". */
function pickSmallestSufficient(cs: Candidate[], dpr: number): Candidate {
  return cs.find((c) => c.density >= dpr) ?? cs[cs.length - 1]
}

/**
 * Regra do Chrome (`HTMLSrcsetParser`, `PickWinner`): acha o primeiro vizinho de densidade ≥ DPR e fica
 * com o MENOR dos dois quando o DPR está abaixo da média geométrica deles (ou seja, pode ampliar).
 */
function pickChrome(cs: Candidate[], dpr: number): Candidate {
  let i = 0
  for (; i < cs.length - 1; i++) {
    const next = cs[i + 1].density
    if (next < dpr) continue
    const current = cs[i].density
    const mean = Math.sqrt(current * next)
    if ((dpr <= 1 && dpr > current) || dpr >= mean) return cs[i + 1]
    break
  }
  return cs[i]
}

function pickBoth(slot: ImageSlot, vw: number, dpr: number) {
  const props = imageSrcSetProps(build(THUMB, DETAIL), slot)
  const cs = candidates(props.srcSet!, slotPx(props.sizes!, vw))
  return { cs, safari: pickSmallestSufficient(cs, dpr), chrome: pickChrome(cs, dpr) }
}

describe('buildImageSrcSet', () => {
  it('com a imagem e os dois derivados: thumb 400w e detail 1280w', () => {
    expect(build(THUMB, DETAIL)).toBe(`${THUMB} ${IMAGE_THUMB_WIDTH}w, ${DETAIL} ${IMAGE_DETAIL_WIDTH}w`)
    expect(IMAGE_THUMB_WIDTH).toBe(400)
    expect(IMAGE_DETAIL_WIDTH).toBe(1280)
  })

  it('sem a imagem exibida (sem foto, ou escondida pela moderação) ⇒ undefined', () => {
    expect(build(THUMB, DETAIL, null)).toBeUndefined()
    expect(buildImageSrcSet({ original: undefined, thumbUrl: THUMB, detailUrl: DETAIL })).toBeUndefined()
    expect(build(THUMB, DETAIL, '')).toBeUndefined()
  })

  it('sem um dos dois (ou nenhum) ⇒ undefined: a <img> fica só com o original', () => {
    expect(build(THUMB, null)).toBeUndefined()
    expect(build(null, DETAIL)).toBeUndefined()
    expect(build(null, null)).toBeUndefined()
    expect(build('', DETAIL)).toBeUndefined()
  })

  it('URL que quebraria o srcset (espaço, vírgula, relativa, outro esquema) ⇒ undefined', () => {
    expect(build('https://x.com/a b.webp', DETAIL)).toBeUndefined()
    expect(build(THUMB, 'https://x.com/a,b.webp')).toBeUndefined()
    expect(build('/recipes/t.webp', DETAIL)).toBeUndefined()
    expect(build('javascript:alert(1)', DETAIL)).toBeUndefined()
  })
})

describe('imageSrcSetProps', () => {
  const srcset = build(THUMB, DETAIL)!

  it('sem srcset ⇒ nada (nem sizes): a <img> fica só com o src original', () => {
    for (const slot of SLOTS) expect(imageSrcSetProps(undefined, slot)).toEqual({})
  })

  it('slots pequenos oferecem os dois; os grandes só o detail', () => {
    for (const slot of ['resultList', 'smallThumb', 'galleryThumb'] as const) {
      expect(imageSrcSetProps(srcset, slot)).toEqual({ srcSet: srcset, sizes: IMAGE_SLOTS[slot].sizes })
    }
    for (const slot of ['detailHero', 'listCard', 'resultGrid'] as const) {
      expect(imageSrcSetProps(srcset, slot)).toEqual({
        srcSet: `${DETAIL} ${IMAGE_DETAIL_WIDTH}w`,
        sizes: IMAGE_SLOTS[slot].sizes,
      })
    }
  })
})

describe('escolha do candidato pelo navegador (sizes de cada slot)', () => {
  it('`thumb: true` SÓ em slot que nunca passa de 200 px CSS (thumb com densidade ≥ 2 em DPR 2)', () => {
    for (const slot of SLOTS) {
      const max = Math.max(...VIEWPORTS.map((vw) => slotPx(IMAGE_SLOTS[slot].sizes, vw)))
      expect({ slot, thumb: IMAGE_SLOTS[slot].thumb }).toEqual({ slot, thumb: max <= IMAGE_THUMB_WIDTH / 2 })
    }
  })

  it('em DPR 1, 1,5 e 2, nenhuma das duas regras escolhe candidato abaixo do necessário havendo um maior', () => {
    for (const slot of SLOTS) {
      for (const vw of VIEWPORTS) {
        for (const dpr of [1, 1.5, 2]) {
          const { cs, safari, chrome } = pickBoth(slot, vw, dpr)
          const largest = cs[cs.length - 1]
          for (const chosen of [safari, chrome]) {
            expect(chosen.density >= dpr || chosen === largest, `${slot} vw=${vw} dpr=${dpr}`).toBe(true)
          }
        }
      }
    }
  })

  it('card do feed/Busca (lista, 128–144 px): thumb em celular até DPR 3 e em desktop até DPR 2', () => {
    for (const vw of [320, 375, 390, 430]) {
      for (const dpr of [1, 2, 3]) {
        const { safari, chrome } = pickBoth('resultList', vw, dpr)
        expect([safari.url, chrome.url]).toEqual([THUMB, THUMB])
      }
    }
    for (const vw of [768, 1024, 1440, 1920]) {
      for (const dpr of [1, 2]) {
        const { safari, chrome } = pickBoth('resultList', vw, dpr)
        expect([safari.url, chrome.url]).toEqual([THUMB, THUMB])
      }
    }
    expect(slotPx(IMAGE_SLOTS.resultList.sizes, 375)).toBe(128)
    expect(slotPx(IMAGE_SLOTS.resultList.sizes, 1440)).toBe(144)
  })

  it('miniaturas (Cardápio, Despensa, cozinheiro, galeria): sempre o thumb', () => {
    for (const slot of ['smallThumb', 'galleryThumb'] as const) {
      for (const vw of [375, 1440]) {
        for (const dpr of [1, 2, 3]) {
          const { safari, chrome } = pickBoth(slot, vw, dpr)
          expect([safari.url, chrome.url]).toEqual([THUMB, THUMB])
        }
      }
    }
  })

  it('capa do detalhe, cards de Minhas criações/Salvos e a grade das semelhantes: sempre o detail', () => {
    for (const slot of ['detailHero', 'listCard', 'resultGrid'] as const) {
      for (const vw of [375, 768, 1440]) {
        for (const dpr of [1, 2, 3]) {
          const { safari, chrome } = pickBoth(slot, vw, dpr)
          expect([safari.url, chrome.url]).toEqual([DETAIL, DETAIL])
        }
      }
    }
    expect(slotPx(IMAGE_SLOTS.detailHero.sizes, 1440)).toBe(784)
    expect(slotPx(IMAGE_SLOTS.detailHero.sizes, 375)).toBe(343)
    expect(slotPx(IMAGE_SLOTS.listCard.sizes, 1440)).toBe(350)
  })

  it('grade das semelhantes: o sizes desconta o `p-3` e a borda do `li` (26 px da célula)', () => {
    // ≥52rem: (784 − 3 × 16) / 4 = 184 de célula ⇒ 158; celular: (100vw − 2rem − 1rem) / 2 − 26.
    expect(slotPx(IMAGE_SLOTS.resultGrid.sizes, 1440)).toBe(158)
    expect(slotPx(IMAGE_SLOTS.resultGrid.sizes, 390)).toBe(145)
    expect(slotPx(IMAGE_SLOTS.resultGrid.sizes, 768)).toBe(142)
  })
})
