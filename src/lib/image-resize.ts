/**
 * Redimensionamento de imagem NO CLIENTE (#126) — antes de subir o avatar, encolhemos a imagem
 * pra bem abaixo do limite de body da Vercel (~4.5 MB) e a re-encodamos em WebP. Roda no browser
 * (usa `createImageBitmap` + `<canvas>`), então é importado SÓ por componentes client.
 *
 * Degrada com segurança: se o canvas/encoder não estiver disponível (ambiente sem suporte), devolve
 * o arquivo original — o servidor ainda valida tipo e tamanho (a borda real é server-side). Nos
 * testes jsdom (sem canvas), este módulo é mockado (`vi.mock`), então a impl real nunca roda lá.
 */

export type ResizeOptions = {
  /** Maior dimensão (px) do resultado; a proporção é preservada. Default 512 (avatar). */
  maxDim?: number
  /** Content-type de saída. Default 'image/webp' (bom equilíbrio tamanho/qualidade). */
  type?: string
  /** Qualidade de encode (0..1). Default 0.85. */
  quality?: number
}

export async function resizeImage(file: File, opts: ResizeOptions = {}): Promise<Blob> {
  const maxDim = opts.maxDim ?? 512
  const type = opts.type ?? 'image/webp'
  const quality = opts.quality ?? 0.85

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file // sem decoder: sobe o original (servidor valida).
  }

  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
    return blob ?? file
  } finally {
    bitmap.close()
  }
}
