/**
 * Comparador de prompt antes/depois (issue #425, ADR-0029 dec.7) — domínio PURO/TOTAL/SEM
 * THROW, sem DB e sem SDK. É o "portão barato" que precede embarcar um prompt novo: roda um
 * punhado de BRIEFINGS FIXOS versionados-em-código pelo prompt VELHO (um snapshot CONGELADO)
 * vs. o NOVO (o `buildSystemPrompt` VIVO de `briefing.ts`) e deixa comparar Receita+imagem
 * lado a lado. Este módulo CONSOME o seam de composição read-only — NÃO o estende (não adiciona
 * eixo a `PromptAxes`) e NÃO persiste nada.
 *
 * A saída da geração NÃO muda (mesmo `RecipeGenSchema`, consultivo FORA da Receita, taxonomia
 * `classify` intacta): o comparador só EXIBE, não altera o contrato. O userPrompt é montado UMA
 * vez pelos `build*Prompt` de `briefing.ts` (idêntico nos dois lados); só o systemPrompt difere —
 * o lado "novo" usa `buildSystemPrompt(mode, axes)` vivo, o "velho" usa o `BASELINE` congelado.
 */

import {
  buildBriefingPrompt,
  buildFreeTextPrompt,
  buildConversationPrompt,
  buildSystemPrompt,
  NEUTRAL_AXES,
  type Briefing,
  type PromptAxes,
  type PromptMode,
} from '@/domain/briefing'
import type { TranscriptMessage } from '@/domain/transcript'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'
import type { GenerationOutcome } from '@/domain/generation'

// ── Cozinhas do comparador (fixo, DB-free e determinístico) ─────────────────────────────────────
// Subconjunto de slugs ATIVOS reais (fonte de verdade: `COZINHA_SEED` em `vocabulary-term.ts`).
// Fixo em código de propósito: mantém o comparador determinístico e sem tocar o DB (é uma bancada
// de teste admin, não a rota de produção que resolve o conjunto vivo). Constrange a SAÍDA de cada
// geração (`generateRecipe({ cozinhaSlugs })`) ao vocabulário controlado (ADR-0025) — a IA nunca
// inventa cozinha. TODA cozinha das fixtures `structured` abaixo pertence a este conjunto.
export const COMPARATOR_COZINHA_SLUGS: readonly string[] = [
  'italiana',
  'japonesa',
  'brasileira',
  'mexicana',
  'francesa',
  'indiana',
  'tailandesa',
  'arabe',
]

// ── BASELINE congelado (o "velho") ──────────────────────────────────────────────────────────────
// Cópia CONGELADA dos prompts-base ATUAIS (fim da Wave 1). É um SNAPSHOT versionado-em-código,
// intencionalmente DESACOPLADO das constantes vivas de `briefing.ts`: quando a Wave 2 enriquecer o
// base OU plugar fragmentos de eixo, o `buildSystemPrompt` vivo (o "novo") DIVERGE deste baseline —
// e essa divergência é EXATAMENTE o que o comparador existe para mostrar. NÃO manter em sincronia
// com `briefing.ts`: a divergência é o sinal. O teste `comparisonSystemPrompts old===new` (registro
// de eixos vazio, Wave 1) trava que a cópia bate byte-a-byte HOJE — se driftar, o CI grita.
const BASELINE_BRIEFING = [
  'Você gera receitas de cozinha no schema canônico.',
  'Escreva passos claros, ordenados e executáveis, com técnicas e pontos de cozimento concretos (tempo, temperatura, textura) quando fizerem diferença.',
  'Respeite estritamente as restrições alimentares e a cozinha indicadas no briefing; use apenas a cozinha indicada, nunca invente uma.',
  'Ingredientes com força "required" são obrigatórios; "preferred" são desejáveis.',
  'A medida de cada ingrediente vai em quantidade e unidade — nunca repita a medida no nome do ingrediente.',
  'Seja honesto: se o pedido for impossível ou contraditório, classifique-o como tal em vez de inventar uma receita que não o atende.',
  'Qualquer alerta, ressalva ou observação de segurança vai no campo consultivo (advisory), NUNCA dentro da receita.',
  'Use linguagem simples e direta, no idioma do pedido.',
].join(' ')

const BASELINE_DISTILLATION = [
  'Você gera receitas de cozinha no schema canônico.',
  'A entrada é uma conversa entre o Usuário e o Assistente; destile a receita pretendida.',
  'Escreva passos claros, ordenados e executáveis, com técnicas e pontos de cozimento concretos (tempo, temperatura, textura) quando fizerem diferença.',
  'Use apenas a cozinha que a conversa indicar; não invente uma cozinha.',
  'A medida de cada ingrediente vai em quantidade e unidade — nunca a repita no nome do ingrediente.',
  'Seja honesto: se o pedido for impossível ou contraditório, classifique-o como tal em vez de inventar.',
  'Qualquer alerta ou ressalva vai no campo consultivo (advisory), nunca dentro da receita.',
  'Use linguagem simples e direta, no idioma da conversa.',
].join(' ')

const BASELINE_CONVERSATION_STREAM =
  BASELINE_DISTILLATION +
  ' Responda ao Usuário em no máximo 1–2 linhas: diga o que você fez ou o que mudou nesta receita.' +
  ' Não escreva preâmbulo nem saudação, e não liste a receita inteira — a receita completa aparece à parte.'

/** Snapshot CONGELADO dos prompts-base por modo (o "velho"). Ver nota acima — NÃO sincronizar. */
export const BASELINE_SYSTEM_PROMPTS: Record<PromptMode, string> = {
  briefing: BASELINE_BRIEFING,
  free_text: BASELINE_BRIEFING,
  distillation: BASELINE_DISTILLATION,
  conversation_stream: BASELINE_CONVERSATION_STREAM,
}

/**
 * Os dois systemPrompts a comparar para um modo/eixos: `new` = `buildSystemPrompt` VIVO (Wave 2 o
 * enriquece), `old` = o `BASELINE` congelado. Wave 1 (registro de eixos vazio) ⇒ `old === new`
 * byte-a-byte (o teste prova o harness). PURO/determinístico.
 */
export function comparisonSystemPrompts(
  mode: PromptMode,
  axes: PromptAxes = NEUTRAL_AXES,
): { old: string; new: string } {
  return { old: BASELINE_SYSTEM_PROMPTS[mode], new: buildSystemPrompt(mode, axes) }
}

// ── Fixtures FIXAS ──────────────────────────────────────────────────────────────────────────────
/**
 * Uma fixture do comparador: um "pedido" versionado-em-código com `id` DETERMINÍSTICO (semente do
 * hash de rotação de estilo da imagem — mesma fixture ⇒ mesma estética, reproduzível). União
 * DISCRIMINADA por `mode` (espelha os 3 caminhos de geração de Receita): `briefing` (structured),
 * `free_text` (texto livre) e `distillation` (destilação da conversa). `conversation_stream` é a
 * resposta-na-tela (call-1), NÃO um caminho de Receita — fica fora do comparador.
 *
 * `axes`: os eixos de composição. Wave 1 é NEUTRO (`NEUTRAL_AXES` / `{}`) — `PromptAxes` está VAZIO
 * nesta branch. Fixtures COM eixos (nivelChef/vozCozinha) entram num follow-up após as fatias de
 * eixo mergearem (não referenciar esses campos aqui: ainda não existem).
 */
export type ComparatorFixture =
  | { id: string; mode: 'briefing'; briefing: Briefing; axes: PromptAxes }
  | { id: string; mode: 'free_text'; freeText: string; axes: PromptAxes }
  | { id: string; mode: 'distillation'; transcript: TranscriptMessage[]; axes: PromptAxes }

/** Atalho: item de briefing raw-text-only (o catálogo de ingredientes é ADIADO → FK null). */
function item(rawText: string, quantidade: string | null, unidade: Briefing['itens'][number]['unidade'], strength: Briefing['itens'][number]['strength'] = 'required'): Briefing['itens'][number] {
  return { ingredientId: null, rawText, quantidade, unidade, strength }
}

/** Atalho: Briefing neutro (sem restrições/observações) com cozinha + itens. */
// #421 removeu Dificuldade como ENTRADA (agora é SAÍDA estimada pela IA) — o Briefing não a carrega.
function briefingFixture(cozinha: string, porcoes: number, itens: Briefing['itens']): Briefing {
  return { cozinha, restricoes: [], porcoes, observacoes: null, itens }
}

/**
 * ~8-10 briefings FIXOS cobrindo os 3 modos e ≥8 cozinhas distintas do vocabulário controlado. Os
 * `id`s são estáveis e únicos (semente da imagem). As fixtures `structured` usam cozinhas dentro de
 * `COMPARATOR_COZINHA_SLUGS` (a saída é constrita a esse conjunto) e são NÃO-vazias por construção.
 */
export const FIXED_BRIEFINGS: readonly ComparatorFixture[] = [
  {
    id: 'cmp-01-italiana-structured',
    mode: 'briefing',
    axes: NEUTRAL_AXES,
    briefing: briefingFixture('italiana', 4, [
      item('arroz arbóreo', '320', 'g'),
      item('cogumelos frescos', '200', 'g'),
      item('queijo parmesão', '80', 'g', 'preferred'),
      item('caldo de legumes', null, 'a_gosto'),
    ]),
  },
  {
    id: 'cmp-02-japonesa-structured',
    mode: 'briefing',
    axes: NEUTRAL_AXES,
    briefing: briefingFixture('japonesa', 2, [
      item('salmão fresco', '300', 'g'),
      item('arroz para sushi', '2', 'xicara'),
      item('folhas de alga nori', '4', 'unidade', 'preferred'),
    ]),
  },
  {
    id: 'cmp-03-brasileira-structured',
    mode: 'briefing',
    axes: NEUTRAL_AXES,
    briefing: briefingFixture('brasileira', 6, [
      item('feijão preto', '500', 'g'),
      item('carne seca', '300', 'g'),
      item('linguiça calabresa', '200', 'g', 'preferred'),
      item('folha de louro', null, 'a_gosto'),
    ]),
  },
  {
    id: 'cmp-04-mexicana-structured',
    mode: 'briefing',
    axes: NEUTRAL_AXES,
    briefing: briefingFixture('mexicana', 4, [
      item('tortilhas de milho', '8', 'unidade'),
      item('feijão refogado', '400', 'g'),
      item('abacate', '2', 'unidade', 'preferred'),
    ]),
  },
  {
    id: 'cmp-05-francesa-structured',
    mode: 'briefing',
    axes: NEUTRAL_AXES,
    briefing: briefingFixture('francesa', 4, [
      item('coxa de frango', '4', 'unidade'),
      item('vinho tinto seco', '250', 'ml'),
      item('cogumelos paris', '200', 'g', 'preferred'),
    ]),
  },
  {
    id: 'cmp-06-indiana-free-text',
    mode: 'free_text',
    axes: NEUTRAL_AXES,
    freeText:
      'Quero um curry indiano cremoso e vegetariano com grão-de-bico e espinafre, temperado com garam masala, para o jantar de hoje. Algo reconfortante e não muito picante.',
  },
  {
    id: 'cmp-07-tailandesa-free-text',
    mode: 'free_text',
    axes: NEUTRAL_AXES,
    freeText:
      'Um prato tailandês rápido de macarrão com camarão, leite de coco e um toque de limão e amendoim. Para duas pessoas, no capricho mas sem complicar.',
  },
  {
    id: 'cmp-08-arabe-conversation',
    mode: 'distillation',
    axes: NEUTRAL_AXES,
    transcript: [
      { role: 'user', content: 'Queria fazer um prato árabe pra receber uns amigos.' },
      { role: 'assistant', content: 'Que tal um homus bem cremoso com pão sírio e um tabule fresco?' },
      { role: 'user', content: 'Perfeito. Pode caprichar no homus com tahine e azeite.' },
    ],
  },
  {
    id: 'cmp-09-brasileira-conversation',
    mode: 'distillation',
    axes: NEUTRAL_AXES,
    transcript: [
      { role: 'user', content: 'Me ajuda a fazer uma sobremesa brasileira simples?' },
      { role: 'assistant', content: 'Um pudim de leite condensado clássico cai bem. Quer com calda de caramelo?' },
      { role: 'user', content: 'Isso, pudim de leite com calda caramelizada, para seis porções.' },
    ],
  },
  {
    id: 'cmp-10-mexicana-free-text',
    mode: 'free_text',
    axes: NEUTRAL_AXES,
    freeText:
      'Uma sopa mexicana quentinha estilo pozole, com milho, pimenta e coentro fresco por cima. Para um almoço de domingo em família.',
  },
]

// ── Prompts por fixture (montagem PURA, reusando build*Prompt) ───────────────────────────────────
/** Lado da comparação: o prompt VIVO (`new`) ou o snapshot CONGELADO (`old`). */
export type ComparisonSide = 'old' | 'new'

/**
 * Monta `{ systemPrompt, userPrompt }` do lado NOVO reusando os `build*Prompt` de `briefing.ts`
 * (fonte única da serialização do pedido). PURO/determinístico.
 */
function fixturePromptNew(fixture: ComparatorFixture): { systemPrompt: string; userPrompt: string } {
  switch (fixture.mode) {
    case 'briefing':
      return buildBriefingPrompt(fixture.briefing, fixture.axes)
    case 'free_text':
      return buildFreeTextPrompt(fixture.freeText, fixture.axes)
    case 'distillation':
      return buildConversationPrompt(fixture.transcript, fixture.axes)
  }
}

/**
 * `{ systemPrompt, userPrompt }` de UM lado da comparação. O userPrompt é IDÊNTICO nos dois lados
 * (montado uma vez pelos `build*Prompt`); só o systemPrompt difere — `new` usa o vivo, `old` troca
 * pelo `BASELINE` congelado do modo. PURO. É o que o runner do servidor passa a `generateRecipe`.
 */
export function comparatorPrompt(
  fixture: ComparatorFixture,
  side: ComparisonSide,
): { systemPrompt: string; userPrompt: string } {
  const built = fixturePromptNew(fixture)
  if (side === 'new') return built
  return { systemPrompt: BASELINE_SYSTEM_PROMPTS[fixture.mode], userPrompt: built.userPrompt }
}

// ── DTOs de saída (dados PUROS — atravessam a rota até a UI) ─────────────────────────────────────
/** Vista enxuta de uma Receita gerada, o que a bancada exibe (título/cozinha/dificuldade/itens/passos). */
export type ComparatorRecipeView = {
  titulo: string
  cozinha: string | null
  dificuldade: number | null
  /** Rótulos de ingrediente já formatados ("nome — quantidade unidade") para leitura direta. */
  ingredientes: string[]
  passos: string[]
}

/** Resultado de UM lado (velho|novo) de uma fixture: o systemPrompt usado, o outcome, a Receita e a imagem. */
export type ComparatorSideResult = {
  side: ComparisonSide
  systemPrompt: string
  outcome: GenerationOutcome
  recipe: ComparatorRecipeView | null
  advisory: string | null
  /** `data:` URL da imagem gerada (quando `withImage` e houve Receita); senão null. */
  imageDataUrl: string | null
}

/** Resposta da rota para UMA fixture: os dois lados lado a lado. */
export type ComparisonResponse = {
  fixtureId: string
  old: ComparatorSideResult
  new: ComparatorSideResult
}

/**
 * PURO: mapeia a Receita crua (`ReceitaGenT`) para a vista da bancada. A medida vai junto ao nome
 * SÓ na exibição (leitura humana) — o schema mantém a medida ESTRUTURADA (ADR-0012); aqui é só
 * formatação de leitura, nunca volta pro `nome` persistido.
 */
export function recipeView(recipe: ReceitaGenT): ComparatorRecipeView {
  return {
    titulo: recipe.titulo,
    cozinha: recipe.cozinha,
    dificuldade: recipe.dificuldade,
    ingredientes: recipe.ingredientes.map((ing) => {
      const medida = [ing.quantidade, ing.unidade].filter((x) => x != null && x !== '').join(' ')
      return medida !== '' ? `${ing.nome} — ${medida}` : ing.nome
    }),
    passos: recipe.passos,
  }
}
