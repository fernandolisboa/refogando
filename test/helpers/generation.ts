import type { Sql } from 'postgres'
import { POST } from '@/app/api/generations/route'
import { getDb } from '@/server/deps'
import { briefing, briefingItem } from '@/db/schema'
import type { GenerationOutput } from '@/domain/generation'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'
import type { Briefing, Strength } from '@/domain/briefing'
import type { Unidade } from '@/domain/vocabulary'

/**
 * Builders de `GenerationOutput` enlatado (issue #8). Cada builder devolve UMA classe
 * da fronteira crua que o `FakeClaudeClient(undefined, canned)` injeta no seam — o
 * teste escolhe a classe e a rota a classifica via `classify` (sem rede, sem API real).
 *
 * `quantidade` é STRING|null (numeric(10,3) trafega como '2.500'), nunca number.
 * porcoes/dificuldade default em faixa válida (PORCOES {1,50} / DIFICULDADE {1,5});
 * sobrescreva para forçar fora-de-faixa → `invalid` no app (não clampa).
 */

/** Receita "miolo" válida por default. Sobrescreva campos pontuais via `overrides`. */
export function makeReceita(overrides: Partial<ReceitaGenT> = {}): ReceitaGenT {
  return {
    titulo: 'Arroz de forno',
    descricao: 'Arroz assado com queijo.',
    passos: ['Misture tudo.', 'Leve ao forno.'],
    notas: 'Sirva quente.',
    originalLocale: 'pt-BR',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: ['sem_gluten'],
    porcoes: 4,
    dificuldade: 2,
    // Gen schema emite `nome` (sem medida) — a medida vai em quantidade/unidade (ADR-0009 Adendo).
    ingredientes: [
      { nome: 'arroz cozido', quantidade: '2.000', unidade: 'xicara' },
      { nome: 'sal', quantidade: null, unidade: 'a_gosto' },
    ],
    ...overrides,
  }
}

/** object + modelKind success (recipe presente). Faixas válidas por default. */
export function cannedSuccess(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Dica: use arroz do dia anterior.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'success', recipe: makeReceita(receita), advisory }
}

/** object + modelKind degraded (recipe presente). */
export function cannedDegraded(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Faltou um ingrediente; ajustei a receita.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'degraded', recipe: makeReceita(receita), advisory }
}

/** object + modelKind playful (recipe presente; salva só em privado). */
export function cannedPlayful(
  receita: Partial<ReceitaGenT> = {},
  advisory: string | null = 'Receita só pela diversão — não tente em casa.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'playful', recipe: makeReceita(receita), advisory }
}

/** object + modelKind impossible (recipe null por contrato; só advisory). */
export function cannedImpossible(
  advisory: string | null = 'Não dá pra fazer bolo só com água.',
): GenerationOutput {
  return { kind: 'object', modelKind: 'impossible', recipe: null, advisory }
}

export function cannedRefusal(): GenerationOutput {
  return { kind: 'refusal' }
}

export function cannedMaxTokens(): GenerationOutput {
  return { kind: 'max_tokens' }
}

export function cannedParseFailed(): GenerationOutput {
  return { kind: 'parse_failed' }
}

// ── Briefing (ENTRADA da #11) ────────────────────────────────────────────────────
//
// Espelha `makeReceita`/`seedRecipe*`/`counts` acima e os de `recipes.ts`. O Briefing é
// o PEDIDO (entrada estruturada), distinto da Receita ENTREGUE — não confundir os dois.
// `quantidade` de item é STRING|null (numeric trafega como string, ex. '2.000'), nunca
// number. cozinha/porcoes/dificuldade default em faixa válida (PORCOES {1,50} /
// DIFICULDADE {1,5}); sobrescreva para forçar fora-de-faixa → 400 no app (não clampa).

/** Briefing "pedido" válido por default (cozinha + 1 item com rawText e strength). */
export function makeBriefing(overrides: Partial<Briefing> = {}): Briefing {
  return {
    cozinha: 'brasileira',
    restricoes: [],
    porcoes: 4,
    dificuldade: 2,
    observacoes: null,
    itens: [
      {
        ingredientId: null,
        rawText: 'arroz cozido',
        quantidade: '2.000',
        unidade: 'xicara',
        strength: 'required',
      },
    ],
    ...overrides,
  }
}

// ── Fábricas de seed do Briefing (espelham seedRecipe / seedRecipeIngredient) ─────
// Inserem via Drizzle e devolvem o uuid RETORNADO (PK não-determinístico). Pai antes
// do filho: `seedBriefing` cria a linha, `seedBriefingItem` pendura nela pelo id.

export async function seedBriefing(input: {
  cozinha?: Briefing['cozinha']
  restricoes?: Briefing['restricoes']
  porcoes?: number | null
  dificuldade?: number | null
  observacoes?: string | null
} = {}): Promise<string> {
  const [row] = await getDb()
    .insert(briefing)
    .values({
      cozinha: input.cozinha ?? null,
      restricoes: input.restricoes,
      porcoes: input.porcoes ?? null,
      dificuldade: input.dificuldade ?? null,
      observacoes: input.observacoes ?? null,
    })
    .returning({ id: briefing.id })
  return row.id
}

export async function seedBriefingItem(input: {
  briefingId: string
  strength: Strength
  ingredientId?: string | null
  rawText?: string | null
  quantidade?: string | null
  unidade?: Unidade | null
  ordem?: number
}): Promise<string> {
  const [row] = await getDb()
    .insert(briefingItem)
    .values({
      briefingId: input.briefingId,
      strength: input.strength,
      ingredientId: input.ingredientId ?? null,
      rawText: input.rawText ?? null,
      quantidade: input.quantidade ?? null,
      unidade: input.unidade ?? null,
      ordem: input.ordem,
    })
    .returning({ id: briefingItem.id })
  return row.id
}

// ── Contagens cruas — inclui briefing/briefing_item (E9) ──────────────────────────
/**
 * Estende as contagens de `counts()` (recipe/creation_session/generation) com `briefing`
 * e `briefing_item` (E9): os casos pre-seam (briefing_vazio/faixa/observacoes) asseram
 * essas duas == 0; sem isso, uma regressão que movesse o INSERT do briefing para ANTES
 * do seam passaria despercebida. Recebe o `Sql` RAW do arquivo de teste (porta alta, sem
 * ORM) — espelha `counts()` em `generation.test.ts:88`.
 */
export async function countsBriefing(
  sql: Sql,
): Promise<{
  recipe: number
  session: number
  generation: number
  briefing: number
  briefingItem: number
}> {
  const [r] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM recipe`
  const [s] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM creation_session`
  const [g] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM generation`
  const [b] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM briefing`
  const [bi] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM briefing_item`
  return { recipe: r.n, session: s.n, generation: g.n, briefing: b.n, briefingItem: bi.n }
}

// ── POST /api/generations (com locale? na query — E8) ─────────────────────────────
/**
 * Chama o handler POST com corpo JSON (+ headers de sessão opcionais). `locale?` monta
 * `?locale=...` na URL (única via que `parseRequestLocale` lê — §4.4/E8); sem ele o caso
 * en-US cairia em pt-BR. Espelha o `post()` local de `generation.test.ts:53` e o `get()`
 * com `?locale` de `recipes-aviso.test.ts:30`. Os args existentes (body, headers) não mudam.
 */
export function post(body: unknown, headers?: Headers, locale?: string): Promise<Response> {
  const qs = locale ? `?locale=${encodeURIComponent(locale)}` : ''
  return POST(
    new Request(`http://localhost/api/generations${qs}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}
