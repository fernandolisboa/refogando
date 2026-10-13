import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { GET, PUT } from '@/app/api/me/restricoes/route'
import { GET as GET_ME } from '@/app/api/me/route'
import { GET as GET_EXPORT } from '@/app/api/me/export/route'
import { getDb, setClaudeClient } from '@/server/deps'
import {
  FakeClaudeClient,
  type ConversationStreamInput,
  type GenerationInput,
} from '@/server/claude/client'
import type { GenerationOutput } from '@/domain/generation'
import { users } from '@/db/schema'
import { eraseOwnAccount } from '@/server/legal/account-erasure'
import { seedSessionHeaders } from '../helpers/users'
import { cannedSuccess, post as postGeneration } from '../helpers/generation'
import { cannedTokens, collectNdjson, makeTranscript, postStream } from '../helpers/conversation'

/**
 * Restrições alimentares SALVAS no perfil (ADR-0041) — `users.restricoes` (migração 0073) e o contrato de
 * `GET/PUT /api/me/restricoes`, mais o que o dado sensível exige: entra no export LGPD, é zerado na
 * eliminação e NÃO vaza pelo `/api/me` (perfil). E as bordas de geração que o recebem como pedido: o Prompt
 * aberto (`restricoes` top-level) e a Conversa (systemPrompt das duas chamadas).
 */

function get(headers?: Headers): Promise<Response> {
  return GET(new Request('http://localhost/api/me/restricoes', { headers }))
}
function put(body: unknown, headers?: Headers): Promise<Response> {
  return PUT(
    new Request('http://localhost/api/me/restricoes', {
      method: 'PUT',
      headers,
      body: JSON.stringify(body),
    }),
  )
}
async function readRestricoes(id: string): Promise<string[] | undefined> {
  const [row] = await getDb().select({ restricoes: users.restricoes }).from(users).where(eq(users.id, id))
  return row?.restricoes
}

/** Fake que GUARDA o que a borda mandou ao seam (os prompts), devolvendo o enlatado. */
class SpyClaudeClient extends FakeClaudeClient {
  generations: GenerationInput[] = []
  streams: ConversationStreamInput[] = []
  constructor(canned: GenerationOutput, tokens?: string[]) {
    super(undefined, canned, tokens)
  }
  override async generateRecipe(input?: GenerationInput): Promise<GenerationOutput> {
    if (input) this.generations.push(input)
    return super.generateRecipe()
  }
  override async *streamConversation(input?: ConversationStreamInput): AsyncIterable<string> {
    if (input) this.streams.push(input)
    yield* super.streamConversation(input)
  }
}

describe('/api/me/restricoes — contrato (ADR-0041)', () => {
  it('Visitante → 401 nos dois verbos', async () => {
    expect((await get()).status).toBe(401)
    expect((await put({ restricoes: ['vegano'] })).status).toBe(401)
  })

  it('conta nova nasce sem restrições; GET devolve [] e não é cacheável', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'nova@restricoes.test' })
    expect(await readRestricoes(userId)).toEqual([])
    const res = await get(headers)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    await expect(res.json()).resolves.toEqual({ restricoes: [] })
  })

  it('PUT grava a forma canônica (sem repetição, ordem do vocabulário); GET relê', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'grava@restricoes.test' })
    const res = await put({ restricoes: ['vegano', 'sem_gluten', 'vegano'] }, headers)
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ restricoes: ['sem_gluten', 'vegano'] })
    expect(await readRestricoes(userId)).toEqual(['sem_gluten', 'vegano'])
    await expect((await get(headers)).json()).resolves.toEqual({ restricoes: ['sem_gluten', 'vegano'] })
  })

  it('PUT [] limpa', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'limpa@restricoes.test' })
    await put({ restricoes: ['low_carb'] }, headers)
    const res = await put({ restricoes: [] }, headers)
    expect(res.status).toBe(200)
    expect(await readRestricoes(userId)).toEqual([])
  })

  it('valor fora do vocabulário / corpo malformado → 400 restricoes_invalidas, nada gravado', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'invalida@restricoes.test' })
    await put({ restricoes: ['vegano'] }, headers)
    for (const body of [{ restricoes: ['vegano', 'kosher'] }, { restricoes: 'vegano' }, {}, null]) {
      const res = await put(body, headers)
      expect(res.status).toBe(400)
      await expect(res.json()).resolves.toEqual({ error: 'restricoes_invalidas' })
    }
    expect(await readRestricoes(userId)).toEqual(['vegano'])
  })

  it('só toca a PRÓPRIA linha (sem id no caminho ⇒ sem IDOR)', async () => {
    const a = await seedSessionHeaders({ email: 'a@restricoes.test' })
    const b = await seedSessionHeaders({ email: 'b@restricoes.test' })
    await put({ restricoes: ['vegano'] }, a.headers)
    expect(await readRestricoes(b.userId)).toEqual([])
  })

  it('NÃO vaza pelo /api/me (o contrato do perfil, parte pública)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'perfil@restricoes.test' })
    await put({ restricoes: ['sem_lactose'] }, headers)
    const body = (await (await GET_ME(new Request('http://localhost/api/me', { headers }))).json()) as Record<
      string,
      unknown
    >
    expect(body).not.toHaveProperty('restricoes')
  })
})

describe('Dados do titular (LGPD) — restrições salvas', () => {
  it('entram no export (account.restricoes)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'export@restricoes.test' })
    await put({ restricoes: ['vegetariano', 'sem_gluten'] }, headers)
    const res = await GET_EXPORT(new Request('http://localhost/api/me/export', { headers }))
    expect(res.status).toBe(200)
    const dump = (await res.json()) as { account: { restricoes: string[]; nivelPadrao: string | null } }
    expect(dump.account.restricoes).toEqual(['sem_gluten', 'vegetariano'])
    expect(dump.account).toHaveProperty('nivelPadrao', null)
  })

  it('são zeradas na eliminação (a linha `users` sobrevive anonimizada) — junto do Nível padrão', async () => {
    const { userId, headers } = await seedSessionHeaders({ email: 'apaga@restricoes.test' })
    await put({ restricoes: ['sem_frutos_do_mar'] }, headers)
    await getDb().update(users).set({ nivelPadrao: 'avancado' }).where(eq(users.id, userId))

    const out = await eraseOwnAccount(getDb(), { userId })
    expect(out.kind).toBe('erased')
    const [row] = await getDb()
      .select({ restricoes: users.restricoes, nivelPadrao: users.nivelPadrao })
      .from(users)
      .where(eq(users.id, userId))
    expect(row).toEqual({ restricoes: [], nivelPadrao: null })
  })
})

describe('Pedidos de geração recebem as restrições (ADR-0041 dec.3)', () => {
  it('Prompt aberto: `restricoes` vira a linha "Restrições:" do userPrompt', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft@restricoes.test' })
    const spy = new SpyClaudeClient(cannedSuccess())
    setClaudeClient(spy)

    const res = await postGeneration(
      { mode: 'free_text', freeText: 'um bolo de cenoura fofinho', restricoes: ['vegano', 'sem_gluten'] },
      headers,
    )
    expect(res.status).toBe(201)
    expect(spy.generations).toHaveLength(1)
    expect(spy.generations[0].userPrompt).toBe('um bolo de cenoura fofinho\n\nRestrições: sem_gluten, vegano')
  })

  it('Prompt aberto: sem `restricoes` o userPrompt segue o texto cru (back-compat)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-sem@restricoes.test' })
    const spy = new SpyClaudeClient(cannedSuccess())
    setClaudeClient(spy)
    const res = await postGeneration({ mode: 'free_text', freeText: 'um bolo de cenoura fofinho' }, headers)
    expect(res.status).toBe(201)
    expect(spy.generations[0].userPrompt).toBe('um bolo de cenoura fofinho')
  })

  it('Prompt aberto: restrição fora do vocabulário → 400 restricao_invalida ANTES do seam', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ft-bad@restricoes.test' })
    const spy = new SpyClaudeClient(cannedSuccess())
    setClaudeClient(spy)
    const res = await postGeneration(
      { mode: 'free_text', freeText: 'um bolo de cenoura fofinho', restricoes: ['kosher'] },
      headers,
    )
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'restricao_invalida' })
    expect(spy.generations).toHaveLength(0)
  })

  it('Conversa: as restrições entram no systemPrompt do stream E da destilação', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv@restricoes.test' })
    const spy = new SpyClaudeClient(cannedSuccess(), cannedTokens(['ok']))
    setClaudeClient(spy)

    const res = await postStream({ transcript: makeTranscript(), restricoes: ['sem_lactose'] }, headers)
    expect(res.status).toBe(200)
    const frames = await collectNdjson(res)
    expect(frames[frames.length - 1].type).toBe('recipe')
    expect(spy.streams[0].systemPrompt).toContain('Restrições alimentares pedidas pelo Usuário: sem_lactose.')
    expect(spy.generations[0].systemPrompt).toContain('Restrições alimentares pedidas pelo Usuário: sem_lactose.')
    // A Transcrição segue verbatim (nada é injetado no conteúdo do Usuário).
    expect(spy.generations[0].userPrompt).not.toContain('sem_lactose')
  })

  it('Conversa: restrição inválida → 400 JSON antes de abrir o stream', async () => {
    const { headers } = await seedSessionHeaders({ email: 'conv-bad@restricoes.test' })
    const spy = new SpyClaudeClient(cannedSuccess(), cannedTokens(['ok']))
    setClaudeClient(spy)
    const res = await postStream({ transcript: makeTranscript(), restricoes: 'vegano' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'restricao_invalida' })
    expect(spy.streams).toHaveLength(0)
  })
})
