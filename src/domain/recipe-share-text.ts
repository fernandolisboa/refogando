import type { Messages } from '@/i18n/messages'

/**
 * Texto de compartilhamento da Receita (#453) — PURO, sem DOM/React. Formato "grupo de WhatsApp"
 * (título → ingredientes → modo de preparo → link), o canal dominante no público pt-BR
 * (CONTEXT.md:168, "Visitante... compartilha por texto"). Consumido pelo `RecipeShareButton` como
 * o `text` do `navigator.share()` — o link já vai EMBUTIDO no fim do texto (não duplicamos como
 * campo `url` separado do Web Share API: alguns alvos de compartilhamento concatenam os dois,
 * o que exibiria o link duas vezes).
 *
 * Cabeçalhos de seção REUSAM os rótulos já localizados do detalhe (`m.detalhe.ingredientes`/
 * `m.detalhe.passos`) — mesmo conceito, não duplicar tradução. Seções vazias (sem ingrediente
 * formatável / sem passo) são OMITIDAS inteiras (ausente ≠ vazio, mesmo princípio do resto do app).
 */
export function buildRecipeShareText(
  input: {
    name: string
    ingredientLines: ReadonlyArray<string>
    steps: ReadonlyArray<string>
    url: string
  },
  m: Messages,
): string {
  const parts: string[] = [input.name]

  if (input.ingredientLines.length > 0) {
    parts.push('', `${m.detalhe.ingredientes}:`)
    for (const line of input.ingredientLines) parts.push(`- ${line}`)
  }

  if (input.steps.length > 0) {
    parts.push('', `${m.detalhe.passos}:`)
    input.steps.forEach((step, i) => parts.push(`${i + 1}. ${step}`))
  }

  parts.push('', input.url)
  return parts.join('\n')
}
