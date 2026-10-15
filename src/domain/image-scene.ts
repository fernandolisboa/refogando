/**
 * Cenário da imagem gerada do prato (ADR-0044) — PURO: vocabulário, regras e biblioteca de cenas.
 * Sem DB/I/O e sem zod: o modal de imagem importa os registros daqui. O prompt do diretor de arte mora
 * em `image-scene-director.ts` e o schema da saída structured em `image-scene-schema.ts`, ambos só no
 * servidor.
 *
 * Antes (#424, ADR-0029 dec.5) o preâmbulo sorteava quatro eixos independentes pelo hash do id da
 * receita (enquadramento, luz, mood, superfície): tudo saía como "foto editorial de prato na mesa", e
 * os eixos brigavam entre si (mood elegante sobre madeira rústica). Agora a foto tem um CENÁRIO: um
 * REGISTRO (caseiro, bistrô, comida de rua...) escolhido a partir da receita, que puxa um bloco de
 * cena COERENTE (ambiente, superfície, louça, luz e clima juntos), mais o enquadramento, a região de
 * origem e um ou dois detalhes de cena.
 *
 * Quem escolhe: o diretor de arte (uma chamada curta ao Claude, tarefa `imageScene` no admin, prompt em
 * `image-scene-director.ts`) lê a receita e devolve o cenário; se ele estiver desligado ou falhar,
 * `sceneFromRules` decide por categoria e cozinha. A escolha do usuário no modal ("Cenário: ...") pula
 * o diretor e gera direto naquele registro.
 *
 * INVARIANTE do ADR-0022 mantido: o prato é sempre o sujeito; o cenário só descreve o entorno.
 */

/** Registros de cena (ADR-0044). A ordem é a do seletor do modal; o slug é estável (vai na API). */
export const IMAGE_SCENE_REGISTROS = [
  'caseiro',
  'rustico_tradicional',
  'bistro',
  'alta_gastronomia',
  'comida_de_rua',
  'boteco',
  'cafe_padaria',
  'festa',
  'ao_ar_livre',
  'estudio',
] as const
export type ImageSceneRegistro = (typeof IMAGE_SCENE_REGISTROS)[number]

/** Enquadramentos (ângulo de câmera) que o diretor pode pedir. */
export const IMAGE_SCENE_ENQUADRAMENTOS = ['de_cima', '45_graus', 'altura_da_mesa', 'close'] as const
export type ImageSceneEnquadramento = (typeof IMAGE_SCENE_ENQUADRAMENTOS)[number]

export type ImageScene = {
  registro: ImageSceneRegistro
  enquadramento: ImageSceneEnquadramento
  /** Região de origem do prato ("Recôncavo Baiano"), só quando a receita indica. Texto curto, sanitizado. */
  regiao: string | null
  /** Um ou dois objetos de cena ("copo de cerveja gelada ao lado"). Texto curto, sanitizado. */
  detalhes: string | null
  /** Quem decidiu: o diretor de arte (IA), as regras de reserva ou o usuário (registro fixado no modal). */
  fonte: 'diretor' | 'regras' | 'usuario'
}

/** Tetos dos textos livres do diretor (entram no prompt da imagem; curtos de propósito). */
export const SCENE_REGIAO_MAX = 40
export const SCENE_DETALHES_MAX = 140

/**
 * Teto da nota VISUAL de uma cozinha (`vocabulary_term.visual_note`, editada no admin): entra no prompt de
 * toda imagem daquela cozinha. Mais curta que a nota de voz (descreve louça e empratamento, não uma
 * tradição). Gateada na borda de escrita (400 no excesso).
 */
export const VISUAL_NOTE_MAX = 400

/** Prazo da chamada ao diretor: estourou, a imagem segue com as regras (nunca falha por isso). */
export const IMAGE_SCENE_DIRECTOR_DEADLINE_MS = 8_000

/**
 * Hash PURO e determinístico de string (FNV-1a 32-bit) — sem `Date.now`/`Math.random`. Mesma string ⇒
 * mesmo número, sempre. Usado só pra rotação de variantes (não-criptográfico).
 */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick<T>(seed: string, items: readonly T[]): T {
  return items[hashString(seed) % items.length]
}

export function isImageSceneRegistro(v: unknown): v is ImageSceneRegistro {
  return typeof v === 'string' && (IMAGE_SCENE_REGISTROS as readonly string[]).includes(v)
}

export function isImageSceneEnquadramento(v: unknown): v is ImageSceneEnquadramento {
  return typeof v === 'string' && (IMAGE_SCENE_ENQUADRAMENTOS as readonly string[]).includes(v)
}

/** Borda da rota: o registro escolhido no modal, ou `null` (automático) para qualquer outra coisa. */
export function parseSceneChoice(raw: unknown): ImageSceneRegistro | null {
  return isImageSceneRegistro(raw) ? raw : null
}

/**
 * Texto livre do diretor → texto seguro para o prompt da imagem: só string; caracteres de controle e
 * quebras de linha viram espaço (não abre parágrafo novo no prompt), espaços colapsados, trim, corte
 * no teto. Vazio ⇒ `null`.
 */
export function sanitizeSceneText(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return null
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean
}

/** Cozinhas cujo prato típico pede panela de barro/ferro e mesa farta (regra de reserva). */
const RUSTIC_CUISINES: ReadonlySet<string> = new Set(['baiana', 'mineira', 'portuguesa', 'arabe', 'indiana'])
/** Cozinhas de lanche de rua (regra de reserva, só com categoria `lanche`). */
const STREET_SNACK_CUISINES: ReadonlySet<string> = new Set(['americana', 'mexicana'])

/**
 * Cenário de RESERVA (sem IA): registro por categoria e cozinha, enquadramento pelo hash do id da
 * receita. Determinístico: mesma receita ⇒ mesmo cenário. Não sabe distinguir um prato contemporâneo
 * de um tradicional (isso é trabalho do diretor de arte). `registroFixo` (escolha do usuário) vence.
 */
export function sceneFromRules(input: {
  recipeId: string
  cozinha: string | null
  categoria: string | null
  registroFixo?: ImageSceneRegistro | null
}): ImageScene {
  const cozinha = input.cozinha?.trim().toLowerCase() ?? null
  const categoria = input.categoria
  let registro: ImageSceneRegistro = 'caseiro'
  if (categoria === 'bebida') registro = 'estudio'
  else if (categoria === 'cafe_da_manha') registro = 'cafe_padaria'
  else if (categoria === 'lanche' && cozinha && STREET_SNACK_CUISINES.has(cozinha)) registro = 'comida_de_rua'
  else if (cozinha === 'francesa') registro = 'bistro'
  else if (cozinha && RUSTIC_CUISINES.has(cozinha)) registro = 'rustico_tradicional'

  return {
    registro: input.registroFixo ?? registro,
    enquadramento: pick(`${input.recipeId}::framing`, IMAGE_SCENE_ENQUADRAMENTOS),
    regiao: null,
    detalhes: null,
    fonte: input.registroFixo ? 'usuario' : 'regras',
  }
}

/**
 * Saída crua do diretor → cenário validado. Registro/enquadramento fora do vocabulário caem no
 * `fallback` (as regras); textos livres passam por `sanitizeSceneText`.
 */
export function normalizeDirectorScene(
  raw: { registro?: unknown; enquadramento?: unknown; regiao?: unknown; detalhes?: unknown },
  fallback: ImageScene,
): ImageScene {
  return {
    registro: isImageSceneRegistro(raw.registro) ? raw.registro : fallback.registro,
    enquadramento: isImageSceneEnquadramento(raw.enquadramento) ? raw.enquadramento : fallback.enquadramento,
    regiao: sanitizeSceneText(raw.regiao, SCENE_REGIAO_MAX),
    detalhes: sanitizeSceneText(raw.detalhes, SCENE_DETALHES_MAX),
    fonte: 'diretor',
  }
}

/**
 * BIBLIOTECA de cenas por registro (ADR-0044): cada variante é um bloco COERENTE (ambiente, superfície,
 * louça, luz e clima juntos). A variante sai do hash do id da receita, então duas receitas do mesmo
 * registro não ficam idênticas e a mesma receita mantém a cena ao regerar. Bump `STYLE_LIBRARY_VERSION`
 * (image-prompt.ts) ao mexer no conteúdo; não reordenar sem intenção.
 */
export const SCENE_LIBRARY: Readonly<Record<ImageSceneRegistro, readonly string[]>> = {
  caseiro: [
    'mesa de cozinha de casa, pano de prato dobrado ao lado, louça simples do dia a dia, luz natural suave de janela',
    'bancada de cozinha caseira com tábua de madeira e utensílios ao fundo desfocados, luz clara de manhã, clima acolhedor',
    'mesa de jantar de família com toalha de algodão, travessa servida no centro, luz quente do fim da tarde',
  ],
  rustico_tradicional: [
    'panela de barro ou de ferro sobre mesa de madeira gasta, colher de pau, fartura, luz quente e lateral',
    'cozinha tradicional com fogão a lenha desfocado ao fundo, louça esmaltada, tons terrosos, clima de almoço de domingo',
    'varanda de casa antiga com mesa de madeira maciça, travessas fartas, luz dourada de fim de tarde',
  ],
  bistro: [
    'mesa pequena de bistrô com tampo de mármore, taça de vinho e talheres simples, salão aconchegante desfocado, luz de fim de tarde',
    'mesa de bistrô com toalha xadrez, louça branca clássica, cesta de pão ao lado, luz quente de luminária',
  ],
  alta_gastronomia: [
    'restaurante refinado, prato branco largo com bastante espaço vazio, empratamento preciso, toalha branca, salão escuro desfocado, luz baixa e pontual sobre o prato',
    'mesa de restaurante contemporâneo com louça autoral de cerâmica, empratamento minimalista com pinça, taça de cristal desfocada, iluminação dramática',
  ],
  comida_de_rua: [
    'balcão de barraca de comida de rua à noite, prato descartável ou papel, luzes da rua em bokeh ao fundo, clima vibrante',
    'carrinho de feira de rua de dia, embalagem simples de papel, movimento desfocado ao fundo, luz natural forte',
  ],
  boteco: [
    'mesa de metal de boteco, copo americano com cerveja gelada, guardanapo de papel, azulejo ao fundo, luz de fim de tarde',
    'balcão de bar tradicional de madeira, porção em prato de louça simples, palitos e limão ao lado, clima descontraído',
  ],
  cafe_padaria: [
    'balcão de padaria com vitrine desfocada ao fundo, xícara de café ao lado, guardanapo de papel, manhã clara',
    'mesa de café da manhã com xícara fumegante, cesta forrada com pano, luz suave de manhã pela janela',
  ],
  festa: [
    'mesa posta para muitas pessoas, travessas e pratos ao redor, decoração discreta de celebração, luz quente e festiva',
    'mesa de festa em família com toalha estampada, copos e guardanapos coloridos ao fundo desfocados, clima alegre',
  ],
  ao_ar_livre: [
    'piquenique na grama com toalha xadrez e cesta, luz natural do dia, árvores desfocadas ao fundo',
    'mesa de quintal ao ar livre perto da churrasqueira, louça simples, luz de sol filtrada pelas folhas',
    'mesa de quiosque de praia, areia e mar desfocados ao fundo, luz clara e quente de verão',
  ],
  estudio: [
    'fundo liso de uma cor sólida que combina com o prato, luz de estúdio limpa e uniforme, sombras suaves',
    'fundo escuro texturizado, luz de estúdio lateral recortando o prato, contraste elegante',
  ],
}

/** Enquadramento → texto do prompt. */
export const ENQUADRAMENTO_TEXT: Readonly<Record<ImageSceneEnquadramento, string>> = {
  de_cima: 'vista de cima (flat lay)',
  '45_graus': 'ângulo de 45 graus',
  altura_da_mesa: 'na altura da mesa (eye-level)',
  close: 'close-up dos detalhes e da textura',
}

/** Variante de cena do registro para esta receita (determinística). */
export function sceneDescription(recipeId: string, registro: ImageSceneRegistro): string {
  return pick(`${recipeId}::scene::${registro}`, SCENE_LIBRARY[registro])
}
