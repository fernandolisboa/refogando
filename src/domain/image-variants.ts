/**
 * Derivados de exibição da Imagem da receita (achado I da auditoria de performance, migração 0077;
 * ADR-0016, atualização de 2026-10-14). PURO e seguro no client (sem zod, sem Node): os cards e o
 * detalhe importam daqui o `srcset` e os `sizes`.
 *
 * O original (`recipe_image.blob_url`, o PNG do Gemini de ~1,5 MB ou a foto enviada) segue sendo o
 * `src` de toda `<img>`: é o fallback quando a imagem ainda não tem derivados (anterior à 0077 e não
 * preenchida pelo backfill, ou a geração deles falhou). Com os dois derivados, a `<img>` ganha
 * `srcset` com eles e `sizes` com a largura do slot, e o navegador escolhe o menor que basta para a
 * densidade da tela. O original nunca entra no `srcset` (não sabemos a largura dele sem decodificar).
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
 * Monta o `srcset` dos derivados. Só com OS DOIS presentes (o CHECK da 0077 garante o par no banco;
 * aqui é defesa): com um só, o navegador o usaria em qualquer tamanho e a capa do detalhe sairia
 * com 400 px. Ausente ("ausente ≠ vazio") ⇒ a `<img>` fica só com o `src` original, como antes.
 */
export function buildImageSrcSet(
  thumbUrl: string | null | undefined,
  detailUrl: string | null | undefined,
): string | undefined {
  if (!thumbUrl || !detailUrl) return undefined
  if (!isSrcSetSafe(thumbUrl) || !isSrcSetSafe(detailUrl)) return undefined
  return `${thumbUrl} ${IMAGE_THUMB_WIDTH}w, ${detailUrl} ${IMAGE_DETAIL_WIDTH}w`
}

/**
 * `sizes` de cada superfície: a largura CSS do slot da `<img>`, espelhando as classes do componente
 * (Tailwind: `sm` = 40rem; contêiner `reading` = 52rem com `px-4 sm:px-6`, ou seja 784 px de conteúdo).
 * Errar para mais só faz o navegador escolher o derivado maior; o layout não muda (é o CSS que manda).
 * Mudou a classe de largura de um card? Ajuste o `sizes` dele aqui.
 */
export const IMAGE_SIZES = {
  /** Capa do detalhe: largura toda do contêiner `reading`. */
  detailHero: '(min-width: 52rem) 784px, (min-width: 40rem) calc(100vw - 3rem), calc(100vw - 2rem)',
  /** `RecipeResultItem` em lista (feed, Busca, Seguindo, perfil, receita da semana): `w-32 sm:w-36`. */
  resultList: '(min-width: 40rem) 9rem, 8rem',
  /** `RecipeResultItem` em grade (semelhantes: `grid-cols-2 sm:grid-cols-4 gap-4` no `reading`). */
  resultGrid: '(min-width: 52rem) 184px, (min-width: 40rem) calc(25vw - 1.5rem), calc(50vw - 1.5rem)',
  /** Card de Minhas criações / Salvos: `grid-cols-1 sm:grid-cols-2 gap-4`, card com `p-4` e borda. */
  listCard: '(min-width: 52rem) 350px, (min-width: 40rem) calc(50vw - 66px), calc(100vw - 66px)',
  /** Miniaturas pequenas: Cardápio, Despensa (`size-10`..`size-16`) e o cartão de cozinheiro (`size-10`). */
  smallThumb: '4rem',
  /** Miniatura da galeria do estúdio de imagem do dono (`size-20`). */
  galleryThumb: '5rem',
} as const
