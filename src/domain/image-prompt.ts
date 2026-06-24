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

/** Teto de caracteres do override do usuário (stopgap de segurança #214). */
export const IMAGE_PROMPT_OVERRIDE_MAX = 200

/**
 * Composição SEGURA do prompt final (#214 stopgap → #223 template estruturado). O `base` montado da
 * receita (`buildDishImagePrompt`: título/ingredientes/cozinha) fica SEMPRE presente — o override do
 * usuário NUNCA o substitui (antes um `||` deixava o override trocar a receita inteira: vetor pra
 * gerar imagem nada-a-ver). Quando há override, ele entra como NOTA DE ESTILO num TEMPLATE ESTRUTURADO
 * (#223) que reafirma EXPLICITAMENTE que o prato descrito acima é o sujeito fotográfico principal e
 * que o seguinte é só refinamento de estilo — reforçando a âncora contra prompt-injection (o refino
 * não consegue virar o sujeito). O refino é trimado e limitado a `IMAGE_PROMPT_OVERRIDE_MAX` chars.
 * Pura e determinística (sem DB/I/O), como o resto do módulo. A UX (base read-only + campo de refino)
 * vive no modal de preview (#223); aqui é o servidor que ancora — a fonte da verdade.
 */
export function composeImagePrompt(base: string, override?: string): string {
  const refino = override?.trim().slice(0, IMAGE_PROMPT_OVERRIDE_MAX)
  return refino
    ? `${base}\n\nNota de estilo — o prato descrito acima é o sujeito fotográfico principal e não deve ser substituído; o seguinte é apenas refinamento de estilo: ${refino}`
    : base
}

/**
 * #285 (ADR-0022 atualização) — composição do prompt de EDIÇÃO (image-to-image): a imagem-base é
 * passada à parte (como `inlineData`); aqui o texto **ancora na receita** igual à geração (o `base`
 * descreve o prato) e enquadra o override como **instrução de edição** sobre a imagem fornecida,
 * reafirmando que o prato NÃO deve ser trocado (mesma postura anti-substituição do `composeImagePrompt`
 * — fecha o vetor "vira o Goku" também na edição). Pura/determinística. O servidor é a âncora.
 */
export function composeEditImagePrompt(base: string, override?: string): string {
  const refino = override?.trim().slice(0, IMAGE_PROMPT_OVERRIDE_MAX)
  return refino
    ? `${base}\n\nEdição — a imagem fornecida é uma foto deste mesmo prato. Aplique APENAS este ajuste, mantendo uma foto realista do MESMO prato (não troque o prato nem o sujeito): ${refino}`
    : base
}
