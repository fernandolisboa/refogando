/**
 * Montagem PURA do prompt de geração da imagem do prato (issue #132, ADR-0017; cenário ADR-0043, que
 * substitui a rotação de eixos do #424/ADR-0029 dec.5). Sem DB/I/O, determinístico. O default é "um
 * clique": o prompt é montado da receita ATUAL (título + ingredientes + cozinha/categoria) com um
 * preâmbulo de CENÁRIO. Quem quiser refina/edita (a rota aceita um refino do usuário, que vira nota de
 * estilo) — mesma filosofia da Extração de ingredientes (a IA pré-preenche, o usuário finaliza).
 *
 * NÃO inclui quantidades (irrelevantes pra aparência) nem passos (a foto é do prato pronto).
 *
 * ── Cenário (ADR-0043) ───────────────────────────────────────────────────────────────────────────
 * O preâmbulo vem de um `ImageScene` já resolvido no servidor (diretor de arte ou regras, ver
 * `image-scene.ts`): o REGISTRO puxa um bloco de cena coerente da biblioteca (variante pelo hash do id
 * da receita), mais o enquadramento, a região de origem e os detalhes de cena (textos curtos já
 * sanitizados), mais a NOTA VISUAL da cozinha (curada no admin, `vocabulary_term.visual_note`).
 *
 * INVARIANTE do ADR-0022 mantido: o servidor SEMPRE compõe o PRATO como sujeito; nem o cenário nem o
 * refino do usuário o substituem.
 */

import { ENQUADRAMENTO_TEXT, sceneDescription, type ImageScene } from '@/domain/image-scene'

export type DishImagePromptInput = {
  /** Id da receita — semente da variante de cena. Mesma receita + mesmo cenário ⇒ mesmo prompt. */
  recipeId: string
  titulo: string
  cozinha: string | null
  categoria: string | null
  /** Rótulos de ingrediente (rawText) — só os nomes; quantidades são irrelevantes pra imagem. */
  ingredientes: ReadonlyArray<string>
  /**
   * Cenário já resolvido no servidor (diretor de arte, escolha do usuário ou regras, ADR-0043). `null`
   * na EDIÇÃO imagem-a-imagem: a cena já está na foto-base, e o prompt fica só com a âncora do prato.
   */
  scene: ImageScene | null
  /** Nota visual da cozinha (`vocabulary_term.visual_note`), ou `null` quando não curada. */
  visualNote: string | null
}

/**
 * Base fixa do preâmbulo — a qualidade fotográfica que NÃO varia e a âncora do prato como sujeito.
 * Sem "editorial": o termo puxava toda foto pro mesmo look de revista.
 */
const STYLE_BASE =
  'Fotografia de comida realista e apetitosa do prato finalizado, foco nítido no prato, que é o sujeito principal da foto.'

/**
 * Versão do conteúdo do preâmbulo (proveniência de prompt — ADR-0029 dec.7). v1 = eixos sorteados
 * (#424); v2 = cenário (ADR-0043). Bump ao mexer na biblioteca de cenas ou nos textos daqui.
 */
export const STYLE_LIBRARY_VERSION = 2

/**
 * Compõe o PREÂMBULO de cenário de UMA receita (ADR-0043): base fixa + cena do registro + câmera +
 * região/detalhes quando houver + nota visual da cozinha quando houver. Sem cenário (edição) ⇒ só a
 * base. PURO e determinístico.
 */
export function buildStylePreamble(recipeId: string, scene: ImageScene | null, visualNote: string | null): string {
  if (!scene) return STYLE_BASE
  const partes = [
    STYLE_BASE,
    `Cena: ${sceneDescription(recipeId, scene.registro)}.`,
    `Câmera: ${ENQUADRAMENTO_TEXT[scene.enquadramento]}.`,
  ]
  if (scene.regiao) partes.push(`Região de origem do prato: ${scene.regiao}.`)
  if (scene.detalhes) partes.push(`Detalhes de cena: ${scene.detalhes}.`)
  const nota = visualNote?.trim()
  // A nota é da COZINHA, não do registro (ex.: "panela de barro" num prato baiano de alta gastronomia):
  // entra como referência subordinada à cena, para não brigar com ela.
  if (nota) partes.push(`Referências visuais da cozinha, só no que combinar com a cena: ${nota}.`)
  return partes.join(' ')
}

export function buildDishImagePrompt(input: DishImagePromptInput): string {
  const preambulo = buildStylePreamble(input.recipeId, input.scene, input.visualNote)
  const partes: string[] = [preambulo, `Prato: ${input.titulo.trim()}.`]

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
