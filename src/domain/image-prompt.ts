/**
 * Montagem PURA do prompt de geração da imagem do prato (issue #132, ADR-0017). Sem DB/I/O,
 * determinístico. O default é "um clique": o prompt é montado da receita ATUAL (título +
 * ingredientes + cozinha/categoria) com um preâmbulo de estilo fotográfico apetitoso. Quem quiser
 * refina/edita (a rota aceita um prompt do usuário no lugar deste) — mesma filosofia da Extração de
 * ingredientes (a IA pré-preenche, o usuário finaliza).
 *
 * NÃO inclui quantidades (irrelevantes pra aparência) nem passos (a foto é do prato pronto).
 */

export type DishImagePromptInput = {
  titulo: string
  cozinha: string | null
  categoria: string | null
  /** Rótulos de ingrediente (rawText) — só os nomes; quantidades são irrelevantes pra imagem. */
  ingredientes: ReadonlyArray<string>
}

/** Preâmbulo de estilo (apetitoso, realista) — fixo; presets de estilo são refino opcional na UI. */
const STYLE_PREAMBLE =
  'Fotografia de comida realista e apetitosa do prato finalizado, luz natural suave, foco nítido, fundo limpo.'

export function buildDishImagePrompt(input: DishImagePromptInput): string {
  const partes: string[] = [STYLE_PREAMBLE, `Prato: ${input.titulo.trim()}.`]

  const ingredientes = input.ingredientes
    .map((i) => i.trim())
    .filter((i) => i.length > 0)
  if (ingredientes.length > 0) {
    partes.push(`Ingredientes principais: ${ingredientes.join(', ')}.`)
  }

  const contexto = [input.cozinha, input.categoria]
    .map((c) => c?.trim())
    .filter((c): c is string => c != null && c.length > 0)
  if (contexto.length > 0) {
    partes.push(`Estilo: ${contexto.join(', ')}.`)
  }

  return partes.join(' ')
}
