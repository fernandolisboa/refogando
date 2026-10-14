/**
 * Derivados de exibição da Imagem da receita (achado I da auditoria de performance, migração 0077;
 * ADR-0016, atualização de 2026-10-14). PURO e seguro no client (sem zod, sem Node): os cards e o
 * detalhe importam daqui o `srcset` e os `sizes` (`imageSrcSetProps`).
 *
 * O original (`recipe_image.blob_url`, o PNG do Gemini de ~1,5 MB ou a foto enviada) segue sendo o
 * `src` de toda `<img>`: é o fallback quando a imagem ainda não tem derivados (anterior à 0077 e não
 * preenchida pelo backfill, ou a geração deles falhou). Com os dois derivados, a `<img>` ganha
 * `srcset` e `sizes` do slot (`imageSrcSetProps`): os slots pequenos oferecem os dois e os grandes só o
 * detail (ver `IMAGE_SLOTS`). O original nunca entra no `srcset` (não sabemos a largura dele sem
 * decodificar).
 *
 * Larguras NOMINAIS: o derivado nunca é ampliado (`withoutEnlargement`), então um original menor que
 * 1280 px gera um `detail` do tamanho do original, descrito como `1280w`. O descritor só orienta a
 * escolha; a imagem servida nunca tem menos pixels que o original na mesma largura de exibição.
 */

/** Largura (px) do derivado de cards e miniaturas (`recipe_image.thumb_url`). */
export const IMAGE_THUMB_WIDTH = 400

/** Largura (px) do derivado da capa do detalhe (`recipe_image.detail_url`). */
export const IMAGE_DETAIL_WIDTH = 1280

/**
 * URL que pode entrar num `srcset`: absoluta http(s) e sem espaço nem vírgula (o `srcset` separa
 * candidatos por vírgula e o descritor por espaço). As do Vercel Blob são `<host>/<prefixo>/<uuid>.webp`.
 * Qualquer outra coisa ⇒ sem `srcset` (o `src` original basta).
 */
function isSrcSetSafe(url: string): boolean {
  return /^https?:\/\/[^\s,]+$/.test(url)
}

/**
 * Monta o `srcset` dos derivados de uma imagem EXIBIDA (`original` = o `blob_url` que vai no `src`).
 * Sem `original` (sem imagem, ou imagem escondida pelo gate de moderação) ⇒ `undefined`: o `srcset`
 * nunca aparece sem a foto. Só com OS DOIS derivados (o CHECK da 0077 garante o par no banco; aqui é
 * defesa): com um só, o navegador o usaria em qualquer tamanho e a capa do detalhe sairia com 400 px.
 * Ausente ("ausente ≠ vazio") ⇒ a `<img>` fica só com o `src` original, como antes.
 */
export function buildImageSrcSet(image: {
  original: string | null | undefined
  thumbUrl: string | null | undefined
  detailUrl: string | null | undefined
}): string | undefined {
  const { original, thumbUrl, detailUrl } = image
  if (original == null || original === '') return undefined
  if (!thumbUrl || !detailUrl) return undefined
  if (!isSrcSetSafe(thumbUrl) || !isSrcSetSafe(detailUrl)) return undefined
  return `${thumbUrl} ${IMAGE_THUMB_WIDTH}w, ${detailUrl} ${IMAGE_DETAIL_WIDTH}w`
}

/**
 * Slots de exibição: o `sizes` (a largura CSS do slot da `<img>`, espelhando as classes do componente;
 * Tailwind: `sm` = 40rem; contêiner `reading` = 52rem com `px-4 sm:px-6`, ou seja 784 px de conteúdo) e
 * se o slot pode receber o thumb de 400 px.
 *
 * `thumb: true` SÓ quando o slot nunca passa de 200 px CSS (400 / 2): assim o thumb tem densidade ≥ 2 em
 * qualquer tela de DPR até 2. A spec deixa a escolha do candidato ao navegador, e o Chrome usa a média
 * geométrica entre candidatos vizinhos: num slot de 350 px em DPR 2 ele escolheria o thumb (densidade
 * 1,14) e ampliaria. Nos slots maiores o `srcset` fica só com o detail (o `src` original segue como
 * fallback sem derivados). `test/unit/image-variants.test.ts` confere essa regra e o `sizes` de cada slot.
 * Errar o `sizes` para mais só faz o navegador escolher o derivado maior; o layout não muda (é o CSS que
 * manda). Mudou a classe de largura de um card? Ajuste o slot dele aqui.
 */
export const IMAGE_SLOTS = {
  /** Capa do detalhe: largura toda do contêiner `reading`. */
  detailHero: {
    sizes: '(min-width: 52rem) 784px, (min-width: 40rem) calc(100vw - 3rem), calc(100vw - 2rem)',
    thumb: false,
  },
  /** `RecipeResultItem` em lista (feed, Busca, Seguindo, perfil, receita da semana): `w-32 sm:w-36`. */
  resultList: { sizes: '(min-width: 40rem) 9rem, 8rem', thumb: true },
  /**
   * `RecipeResultItem` em grade (semelhantes: `grid-cols-2 sm:grid-cols-4 gap-4` no `reading`), dentro
   * do `li` com `p-3` e borda de 1 px (26 px a menos que a célula). Chega a ~270 px num celular deitado.
   */
  resultGrid: {
    sizes: '(min-width: 52rem) 158px, (min-width: 40rem) calc(25vw - 50px), calc(50vw - 50px)',
    thumb: false,
  },
  /** Card de Minhas criações / Salvos: `grid-cols-1 sm:grid-cols-2 gap-4`, card com `p-4` e borda. */
  listCard: {
    sizes: '(min-width: 52rem) 350px, (min-width: 40rem) calc(50vw - 66px), calc(100vw - 66px)',
    thumb: false,
  },
  /** Miniaturas pequenas: Cardápio, Despensa (`size-10`..`size-16`) e o cartão de cozinheiro (`size-10`). */
  smallThumb: { sizes: '4rem', thumb: true },
  /** Miniatura da galeria do estúdio de imagem do dono (`size-20`). */
  galleryThumb: { sizes: '5rem', thumb: true },
} as const satisfies Record<string, { sizes: string; thumb: boolean }>

export type ImageSlot = keyof typeof IMAGE_SLOTS

/**
 * `srcSet`/`sizes` da `<img>` de um slot. Sem `srcSet` (imagem sem derivados) ⇒ `{}`: a `<img>` fica
 * só com o `src` original. Slot sem thumb ⇒ o candidato `400w` sai e fica só o detail. O `srcSet` vem
 * de `buildImageSrcSet` (candidatos separados por `", "`, URLs sem vírgula nem espaço), então cortar o
 * candidato pelo descritor é seguro.
 */
export function imageSrcSetProps(
  srcSet: string | undefined,
  slot: ImageSlot,
): { srcSet?: string; sizes?: string } {
  if (!srcSet) return {}
  const { sizes, thumb } = IMAGE_SLOTS[slot]
  const candidates = thumb
    ? srcSet
    : srcSet
        .split(', ')
        .filter((c) => !c.endsWith(` ${IMAGE_THUMB_WIDTH}w`))
        .join(', ')
  return candidates ? { srcSet: candidates, sizes } : {}
}
