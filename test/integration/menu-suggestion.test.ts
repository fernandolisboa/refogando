import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient, type GenerationInput } from '@/server/claude/client'
import { appConfig, mealPlanEntry, mealPlanSuggestionEvent } from '@/db/schema'
import { MAX_MEAL_PLAN_ENTRIES_PER_DAY, type MealSlot } from '@/domain/meal-plan'
import { MENU_SUGGESTION_CAP_BY_ROLE, type MenuSuggestionOutput, type MenuSuggestionRaw } from '@/domain/menu-suggestion'
import type { Categoria, Restricao } from '@/domain/vocabulary'
import type { Role } from '@/domain/user'
import { POST as suggestRoute } from '@/app/api/me/meal-plan/suggestions/route'
import { POST as applyRoute } from '@/app/api/me/meal-plan/suggestions/apply/route'
import { seedSessionHeaders } from '../helpers/users'
import { seedRecipe, seedRemovedFromPool, seedSave, seedTranslation } from '../helpers/recipes'

/**
 * Sugestão de cardápio pela IA (ADR-0036) pela porta mais alta (route handlers). O seam do Claude é um
 * dublê que GUARDA o prompt recebido e responde com uma função do prompt (escolhe candidatas pelo
 * título), então os testes asseguram o que vai pro modelo (privacidade, filtros) e o que volta da saída
 * (tudo fora do pedido é descartado). Inegociáveis: privada de outro nunca é candidata; restrição é
 * filtro duro; cota barra antes do modelo; o aceite re-valida cada entrada e nunca mexe nas porções de
 * uma Refeição já planejada.
 */

// ── Dublê do Claude ─────────────────────────────────────────────────────────────
type Responder = (prompt: string) => MenuSuggestionOutput

class CapturingClient extends FakeClaudeClient {
  prompts: GenerationInput[] = []
  constructor(private readonly respond: Responder) {
    super()
  }
  override async suggestMenu(input?: GenerationInput): Promise<MenuSuggestionOutput> {
    if (input) this.prompts.push(input)
    return this.respond(input?.userPrompt ?? '')
  }
}

function useClient(respond: Responder): CapturingClient {
  const client = new CapturingClient(respond)
  setClaudeClient(client)
  return client
}

const ok = (suggestion: MenuSuggestionRaw): MenuSuggestionOutput => ({
  kind: 'ok',
  suggestion,
  usage: { inputTokens: 1000, outputTokens: 200 },
})

/** Linhas de um bloco `<tag>…</tag>` do prompt (sem o cabeçalho). */
function block(prompt: string, tag: string): string[] {
  const start = prompt.indexOf(`<${tag}>`)
  const end = prompt.indexOf(`</${tag}>`)
  return prompt.slice(start, end).split('\n').slice(2).filter(Boolean)
}

function recipeKey(prompt: string, titulo: string): string {
  const line = block(prompt, 'receitas').find((l) => l.split(' | ')[1] === titulo)
  if (!line) throw new Error(`candidata ausente: ${titulo}`)
  return line.split(' | ')[0]
}

function targetKeys(prompt: string): string[] {
  return block(prompt, 'alvos').map((l) => l.split(' | ')[0])
}

function candidateTitles(prompt: string): string[] {
  return block(prompt, 'receitas').map((l) => l.split(' | ')[1])
}

// ── Invocadores ─────────────────────────────────────────────────────────────────
function jsonReq(url: string, headers?: Headers, body?: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

function suggest(body: Record<string, unknown>, headers?: Headers): Promise<Response> {
  return suggestRoute(jsonReq('/api/me/meal-plan/suggestions?locale=pt-BR', headers, body))
}

function apply(body: Record<string, unknown>, headers?: Headers): Promise<Response> {
  return applyRoute(jsonReq('/api/me/meal-plan/suggestions/apply', headers, body))
}

type PreviewBody = {
  items: { day: string; slot: MealSlot; motivo: string; recipe: { id: string; name: string } }[]
  comentario: string
  targetCount: number
}

// ── Seeds ───────────────────────────────────────────────────────────────────────
let seq = 0
async function session(role?: Role) {
  return seedSessionHeaders({ email: `ms-${seq++}-${crypto.randomUUID()}@ex.com`, ...(role ? { role } : {}) })
}

async function seedCatalog(
  titulo: string,
  opts: { categoria?: Categoria | null; restricoes?: Restricao[]; resultKind?: 'playful' } = {},
): Promise<string> {
  const recipeId = await seedRecipe({
    origin: 'catalog',
    originalLocale: 'pt-BR',
    ownerId: null,
    categoria: opts.categoria === undefined ? 'prato_principal' : opts.categoria,
    restricoes: opts.restricoes ?? [],
    ...(opts.resultKind ? { resultKind: opts.resultKind } : {}),
  })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return recipeId
}

async function seedUserRecipe(
  ownerId: string,
  titulo: string,
  opts: { visibility?: 'public' | 'private'; origin?: 'ai_structured' | 'web_imported' } = {},
): Promise<string> {
  const recipeId = await seedRecipe({
    origin: opts.origin ?? 'ai_structured',
    originalLocale: 'pt-BR',
    ownerId,
    visibility: opts.visibility ?? 'private',
    categoria: 'prato_principal',
  })
  await seedTranslation({ recipeId, locale: 'pt-BR', titulo, provenance: 'escrita_por_pessoa' })
  return recipeId
}

const MON = '2026-10-05'
const TUE = '2026-10-06'
const WED = '2026-10-07'
const NEXT_MON = '2026-10-12'

const BASE = { days: [MON, TUE], slots: ['jantar'] }

async function ledger(userId: string) {
  return getDb().select().from(mealPlanSuggestionEvent).where(eq(mealPlanSuggestionEvent.userId, userId))
}

// ── Acesso e validação ──────────────────────────────────────────────────────────
describe('Sugestão de cardápio — acesso e validação', () => {
  it('Visitante ⇒ 401 nas duas rotas, sem tocar o modelo', async () => {
    const client = useClient(() => ({ kind: 'parse_failed' }))
    expect((await suggest(BASE)).status).toBe(401)
    expect((await apply({ entries: [] })).status).toBe(401)
    expect(client.prompts).toHaveLength(0)
  })

  it.each([
    ['sem dias', { slots: ['jantar'] }],
    ['dias de semanas diferentes', { days: [MON, NEXT_MON], slots: ['jantar'] }],
    ['dia repetido', { days: [MON, MON], slots: ['jantar'] }],
    ['refeição inválida', { days: [MON], slots: ['ceia'] }],
    ['restrição fora do vocabulário', { ...BASE, restricoes: ['paleo'] }],
    ['porções fora da faixa', { ...BASE, porcoes: 0 }],
    ['nota longa demais', { ...BASE, note: 'x'.repeat(201) }],
    ['fonte desconhecida', { ...BASE, source: 'web' }],
  ])('%s ⇒ 400 dados_invalidos, sem ledger', async (_label, body) => {
    const { userId, headers } = await session()
    const client = useClient(() => ({ kind: 'parse_failed' }))
    const res = await suggest(body, headers)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'dados_invalidos' })
    expect(client.prompts).toHaveLength(0)
    expect(await ledger(userId)).toHaveLength(0)
  })
})

// ── Candidatas ──────────────────────────────────────────────────────────────────
describe('Sugestão de cardápio — o que vai pro modelo', () => {
  it('privacidade: própria privada e salvas entram; privada de outro, removida, playful e importada NUNCA', async () => {
    const me = await session()
    const other = await session()
    const curator = await session('curador')
    await seedUserRecipe(me.userId, 'Minha privada')
    await seedUserRecipe(me.userId, 'Minha importada', { origin: 'web_imported' })
    await seedUserRecipe(other.userId, 'Privada alheia')
    const publicOther = await seedUserRecipe(other.userId, 'Pública alheia', { visibility: 'public' })
    await seedSave({ userId: me.userId, recipeId: publicOther })
    await seedCatalog('Catálogo aprovado')
    await seedCatalog('Catálogo lúdico', { resultKind: 'playful' })
    const removed = await seedCatalog('Catálogo removido')
    await seedRemovedFromPool({ recipeId: removed, curatorId: curator.userId })

    const client = useClient(() => ok({ itens: [], comentario: '' }))
    const res = await suggest(BASE, me.headers)
    expect(res.status).toBe(200)
    const prompt = client.prompts[0].userPrompt
    const titles = candidateTitles(prompt)
    expect(titles).toEqual(expect.arrayContaining(['Minha privada', 'Pública alheia', 'Catálogo aprovado']))
    for (const never of ['Privada alheia', 'Minha importada', 'Catálogo lúdico', 'Catálogo removido']) {
      expect(prompt).not.toContain(never)
    }
    // O acervo vem marcado e antes do pool.
    expect(block(prompt, 'receitas').find((l) => l.includes('Minha privada'))).toContain('acervo')
    expect(block(prompt, 'receitas').find((l) => l.includes('Catálogo aprovado'))).toContain('comunidade')
  })

  it('source=mine: só o acervo (salvas + minhas); sem acervo ⇒ 422 sem_candidatas e nada gasto', async () => {
    const me = await session()
    await seedCatalog('Só no catálogo')
    const client = useClient(() => ok({ itens: [], comentario: '' }))

    const empty = await suggest({ ...BASE, source: 'mine' }, me.headers)
    expect(empty.status).toBe(422)
    expect(await empty.json()).toEqual({ error: 'sem_candidatas' })
    expect(client.prompts).toHaveLength(0)
    expect(await ledger(me.userId)).toHaveLength(0)

    await seedUserRecipe(me.userId, 'Meu risoto')
    expect((await suggest({ ...BASE, source: 'mine' }, me.headers)).status).toBe(200)
    expect(candidateTitles(client.prompts[0].userPrompt)).toEqual(['Meu risoto'])
  })

  it('restrição é filtro DURO: só entra quem declara todas as pedidas', async () => {
    const me = await session()
    await seedCatalog('Curry vegano sem glúten', { restricoes: ['vegano', 'sem_gluten'] })
    await seedCatalog('Salada vegana', { restricoes: ['vegano'] })
    await seedCatalog('Bife')
    const client = useClient(() => ok({ itens: [], comentario: '' }))
    await suggest({ ...BASE, restricoes: ['vegano', 'sem_gluten'] }, me.headers)
    expect(candidateTitles(client.prompts[0].userPrompt)).toEqual(['Curry vegano sem glúten'])
  })

  it('categoria casa a refeição: bebida/molho nunca; café da manhã não recebe prato principal', async () => {
    const me = await session()
    await seedCatalog('Suco verde', { categoria: 'bebida' })
    await seedCatalog('Pesto', { categoria: 'molho' })
    await seedCatalog('Panqueca', { categoria: 'cafe_da_manha' })
    await seedCatalog('Lasanha', { categoria: 'prato_principal' })
    await seedCatalog('Sem categoria', { categoria: null })
    const client = useClient(() => ok({ itens: [], comentario: '' }))

    await suggest({ days: [MON], slots: ['cafe_da_manha'] }, me.headers)
    expect(candidateTitles(client.prompts[0].userPrompt).sort()).toEqual(['Panqueca', 'Sem categoria'])

    await suggest({ days: [MON], slots: ['jantar'] }, me.headers)
    expect(candidateTitles(client.prompts[1].userPrompt).sort()).toEqual(['Lasanha', 'Sem categoria'])
  })

  it('onlyEmpty pula o que já está planejado; tudo cheio ⇒ 422 nada_a_preencher; a planejada vem marcada', async () => {
    const me = await session()
    const lasanha = await seedCatalog('Lasanha')
    await getDb().insert(mealPlanEntry).values({ userId: me.userId, day: MON, slot: 'jantar', recipeId: lasanha })
    const client = useClient(() => ok({ itens: [], comentario: '' }))

    const res = await suggest(BASE, me.headers)
    expect(((await res.json()) as PreviewBody).targetCount).toBe(1)
    const prompt = client.prompts[0].userPrompt
    expect(block(prompt, 'alvos')).toHaveLength(1)
    expect(block(prompt, 'alvos')[0]).toContain(TUE)
    expect(block(prompt, 'receitas').find((l) => l.includes('Lasanha'))).toContain('no cardápio')

    const full = await suggest({ days: [MON], slots: ['jantar'] }, me.headers)
    expect(full.status).toBe(422)
    expect(await full.json()).toEqual({ error: 'nada_a_preencher' })
    expect(await ledger(me.userId)).toHaveLength(1)
  })

  it('usa o modelo e o ajuste da tarefa `menu` do admin (ADR-0034)', async () => {
    const me = await session()
    await seedCatalog('Lasanha')
    await getDb()
      .insert(appConfig)
      .values({
        id: true,
        aiTasks: { menu: { model: 'claude-opus-5-5', byModel: { 'claude-opus-5-5': { effort: 'high', thinking: 'off' } } } },
      })
      .onConflictDoUpdate({
        target: appConfig.id,
        set: { aiTasks: { menu: { model: 'claude-opus-5-5', byModel: { 'claude-opus-5-5': { effort: 'high', thinking: 'off' } } } } },
      })
    const client = useClient(() => ok({ itens: [], comentario: '' }))
    await suggest(BASE, me.headers)
    expect(client.prompts[0].model).toBe('claude-opus-5-5')
    expect(client.prompts[0].settings).toEqual({ effort: 'high', thinking: 'off' })
  })
})

// ── Saída ───────────────────────────────────────────────────────────────────────
describe('Sugestão de cardápio — a prévia', () => {
  it('só itens válidos viram prévia (chave inventada, alvo fora e alvo repetido caem); ledger com custo', async () => {
    const me = await session()
    const lasanhaId = await seedCatalog('Lasanha')
    const moquecaId = await seedCatalog('Moqueca')
    useClient((prompt) => {
      const [a1, a2] = targetKeys(prompt)
      return ok({
        itens: [
          { alvo: a1, receita: recipeKey(prompt, 'Lasanha'), motivo: 'Clássico de segunda.' },
          { alvo: a1, receita: recipeKey(prompt, 'Moqueca'), motivo: 'repetido: cai' },
          { alvo: 'a99', receita: recipeKey(prompt, 'Moqueca'), motivo: 'alvo fora: cai' },
          { alvo: a2, receita: 'r999', motivo: 'chave inventada: cai' },
          { alvo: ` ${a2.toUpperCase()} `, receita: recipeKey(prompt, 'Moqueca'), motivo: 'Peixe\nna terça <b>' },
        ],
        comentario: 'Semana equilibrada.',
      })
    })

    const res = await suggest(BASE, me.headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const body = (await res.json()) as PreviewBody
    expect(body.items).toEqual([
      { day: MON, slot: 'jantar', motivo: 'Clássico de segunda.', recipe: expect.objectContaining({ id: lasanhaId, name: 'Lasanha' }) },
      { day: TUE, slot: 'jantar', motivo: 'Peixe na terça b', recipe: expect.objectContaining({ id: moquecaId, name: 'Moqueca' }) },
    ])
    expect(body.comentario).toBe('Semana equilibrada.')
    // Nada foi gravado no plano: a prévia é só prévia.
    expect(await getDb().select().from(mealPlanEntry)).toHaveLength(0)

    const [event] = await ledger(me.userId)
    expect(event).toMatchObject({ model: 'claude-sonnet-5', inputTokens: 1000, outputTokens: 200 })
    expect(Number(event.costUsd)).toBeCloseTo((1000 * 3 + 200 * 15) / 1e6, 6)
  })

  it('com onlyEmpty=false, a Receita já planejada naquele mesmo dia × refeição cai da prévia', async () => {
    const me = await session()
    const lasanha = await seedCatalog('Lasanha')
    await getDb().insert(mealPlanEntry).values({ userId: me.userId, day: MON, slot: 'jantar', recipeId: lasanha })
    useClient((prompt) => {
      const [a1] = targetKeys(prompt)
      return ok({ itens: [{ alvo: a1, receita: recipeKey(prompt, 'Lasanha'), motivo: 'x' }], comentario: '' })
    })
    const res = await suggest({ days: [MON], slots: ['jantar'], onlyEmpty: false }, me.headers)
    expect(((await res.json()) as PreviewBody).items).toEqual([])
  })

  it('falha ou recusa do modelo ⇒ 502 sugestao_falhou (o slot fica gasto)', async () => {
    const me = await session()
    await seedCatalog('Lasanha')
    useClient(() => ({ kind: 'parse_failed' }))
    const res = await suggest(BASE, me.headers)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'sugestao_falhou' })
    useClient(() => ({ kind: 'refusal' }))
    expect((await suggest(BASE, me.headers)).status).toBe(502)
    expect(await ledger(me.userId)).toHaveLength(2)
  })
})

// ── Cota ────────────────────────────────────────────────────────────────────────
describe('Sugestão de cardápio — cota diária', () => {
  it('no teto do papel ⇒ 429 limite_sugestao com countdown, sem tocar o modelo', async () => {
    const me = await session()
    await seedCatalog('Lasanha')
    const cap = MENU_SUGGESTION_CAP_BY_ROLE.usuario as number
    await getDb()
      .insert(mealPlanSuggestionEvent)
      .values(Array.from({ length: cap }, () => ({ userId: me.userId })))
    const client = useClient(() => ok({ itens: [], comentario: '' }))
    const res = await suggest(BASE, me.headers)
    expect(res.status).toBe(429)
    const body = (await res.json()) as { error: string; retryAfterMs: number }
    expect(body.error).toBe('limite_sugestao')
    expect(body.retryAfterMs).toBeGreaterThan(0)
    expect(client.prompts).toHaveLength(0)
  })

  it('concorrência: N pedidos simultâneos no limite ⇒ só os que cabem chegam ao modelo', async () => {
    const me = await session()
    await seedCatalog('Lasanha')
    const cap = MENU_SUGGESTION_CAP_BY_ROLE.usuario as number
    await getDb()
      .insert(mealPlanSuggestionEvent)
      .values(Array.from({ length: cap - 1 }, () => ({ userId: me.userId })))
    const client = useClient(() => ok({ itens: [], comentario: '' }))
    const statuses = await Promise.all([1, 2, 3].map(() => suggest(BASE, me.headers).then((r) => r.status)))
    expect(statuses.filter((s) => s === 200)).toHaveLength(1)
    expect(statuses.filter((s) => s === 429)).toHaveLength(2)
    expect(client.prompts).toHaveLength(1)
    expect(await ledger(me.userId)).toHaveLength(cap)
  })

  it('admin é ilimitado, mas a chamada fica no ledger (custo medido)', async () => {
    const admin = await session('admin')
    await seedCatalog('Lasanha')
    await getDb()
      .insert(mealPlanSuggestionEvent)
      .values(Array.from({ length: 20 }, () => ({ userId: admin.userId })))
    useClient(() => ok({ itens: [], comentario: '' }))
    expect((await suggest(BASE, admin.headers)).status).toBe(200)
    expect(await ledger(admin.userId)).toHaveLength(21)
  })
})

// ── Aceite ──────────────────────────────────────────────────────────────────────
describe('Sugestão de cardápio — aceitar', () => {
  it('grava as entradas; pula inelegível (privada de outro) sem vazar nada', async () => {
    const me = await session()
    const other = await session()
    const lasanha = await seedCatalog('Lasanha')
    const alheia = await seedUserRecipe(other.userId, 'Privada alheia')
    const res = await apply(
      {
        entries: [
          { recipeId: lasanha, day: MON, slot: 'jantar', porcoes: 4 },
          { recipeId: alheia, day: TUE, slot: 'jantar', porcoes: 4 },
          { recipeId: lasanha, day: MON, slot: 'jantar', porcoes: 4 }, // duplicada: colapsa
        ],
      },
      me.headers,
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ addedCount: 1, skippedCount: 1 })
    const rows = await getDb().select().from(mealPlanEntry).where(eq(mealPlanEntry.userId, me.userId))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ recipeId: lasanha, day: MON, slot: 'jantar', porcoes: 4 })
  })

  it('já planejada no mesmo dia × refeição ⇒ pula SEM mexer nas porções ajustadas', async () => {
    const me = await session()
    const lasanha = await seedCatalog('Lasanha')
    await getDb()
      .insert(mealPlanEntry)
      .values({ userId: me.userId, day: MON, slot: 'jantar', recipeId: lasanha, porcoes: 7 })
    const res = await apply({ entries: [{ recipeId: lasanha, day: MON, slot: 'jantar', porcoes: 2 }] }, me.headers)
    expect(await res.json()).toEqual({ addedCount: 0, skippedCount: 1 })
    const [row] = await getDb().select().from(mealPlanEntry).where(eq(mealPlanEntry.userId, me.userId))
    expect(row.porcoes).toBe(7)
  })

  it('dia cheio ⇒ pula o excedente', async () => {
    const me = await session()
    const ids = await Promise.all(
      Array.from({ length: MAX_MEAL_PLAN_ENTRIES_PER_DAY }, (_, i) => seedCatalog(`Prato ${i}`)),
    )
    await getDb()
      .insert(mealPlanEntry)
      .values(ids.slice(0, MAX_MEAL_PLAN_ENTRIES_PER_DAY - 1).map((recipeId) => ({ userId: me.userId, day: WED, slot: 'almoco' as const, recipeId })))
    const extra = await seedCatalog('Mais um')
    const res = await apply(
      {
        entries: [
          { recipeId: ids[MAX_MEAL_PLAN_ENTRIES_PER_DAY - 1], day: WED, slot: 'jantar', porcoes: null },
          { recipeId: extra, day: WED, slot: 'jantar', porcoes: null },
        ],
      },
      me.headers,
    )
    expect(await res.json()).toEqual({ addedCount: 1, skippedCount: 1 })
  })

  it.each([
    ['vazio', { entries: [] }],
    ['sem entries', {}],
    ['semanas diferentes', { entries: [{ recipeId: crypto.randomUUID(), day: MON, slot: 'jantar' }, { recipeId: crypto.randomUUID(), day: NEXT_MON, slot: 'jantar' }] }],
    ['id malformado', { entries: [{ recipeId: 'x', day: MON, slot: 'jantar' }] }],
    ['acima do teto', { entries: Array.from({ length: 29 }, () => ({ recipeId: crypto.randomUUID(), day: MON, slot: 'jantar' })) }],
  ])('%s ⇒ 400 dados_invalidos', async (_label, body) => {
    const me = await session()
    const res = await apply(body, me.headers)
    expect(res.status).toBe(400)
  })
})
