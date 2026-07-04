import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { eq } from 'drizzle-orm'
import { makeSql } from '@/db/client'
import { getDb, setClaudeClient } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { creationSession, generation, users } from '@/db/schema'
import { seedSessionHeaders } from '../helpers/users'
import { seedVocabularyCozinhas } from '../helpers/vocabulary'
import { cannedSuccess, makeBriefing, post } from '../helpers/generation'
import type { PromptStamp } from '@/domain/briefing'

/**
 * Eixo Nível de habilidade (#421, ADR-0029 dec.2) — a BORDA de POST /api/generations pela porta mais
 * alta. Verifica o wiring da resolução dos eixos SEM inspecionar o prompt cru: cada geração CARIMBA
 * `generation.prompt_stamp.axes` (o carimbo que a borda montou), então lemos esse jsonb para provar:
 *  - default do Perfil (users.nivelPadrao) flui pro eixo quando não há override;
 *  - override TOP-LEVEL (`body.nivel`) VENCE o default do Perfil;
 *  - sem default e sem override ⇒ eixo NEUTRO (axes vazio).
 * O FakeClaudeClient devolve um success enlatado; o systemPrompt já embute o fragmento (testado no
 * unit de briefing) — aqui provamos que a BORDA resolveu o eixo certo.
 *
 * Os briefings usam `cozinha: null` de propósito: ISOLAM o eixo Nível do eixo cozinha-como-voz (#422),
 * que também carimbaria `axes.vozCozinha` quando há cozinha — então o `toEqual` do axes fica focado no
 * nivelChef sem acoplar à voz.
 */

let sql: Sql

beforeAll(async () => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql.end({ timeout: 5 })
})

async function setNivelPadrao(userId: string, nivel: string | null): Promise<void> {
  await getDb().update(users).set({ nivelPadrao: nivel }).where(eq(users.id, userId))
}

async function lastStamp(userId: string): Promise<PromptStamp | null> {
  // A generation pende da creation_session, que carrega o userId — escopamos por ele.
  const [row] = await getDb()
    .select({ promptStamp: generation.promptStamp })
    .from(generation)
    .innerJoin(creationSession, eq(creationSession.id, generation.creationSessionId))
    .where(eq(creationSession.userId, userId))
    .limit(1)
  return row?.promptStamp ?? null
}

describe('POST /api/generations — eixo Nível de habilidade na borda (#421)', () => {
  it('default do Perfil (nivelPadrao) → carimbado no prompt_stamp.axes quando não há override', async () => {
    await seedVocabularyCozinhas(getDb())
    setClaudeClient(new FakeClaudeClient((t) => t, cannedSuccess()))
    const { userId, headers } = await seedSessionHeaders({ email: 'defnivel@nivel.gen.test' })
    await setNivelPadrao(userId, 'iniciante')

    const res = await post({ mode: 'structured', briefing: makeBriefing({ cozinha: null }) }, headers)
    expect(res.status).toBe(201)

    const stamp = await lastStamp(userId)
    expect(stamp?.axes).toEqual({ nivelChef: 'iniciante' })
  })

  it('override TOP-LEVEL body.nivel VENCE o default do Perfil', async () => {
    await seedVocabularyCozinhas(getDb())
    setClaudeClient(new FakeClaudeClient((t) => t, cannedSuccess()))
    const { userId, headers } = await seedSessionHeaders({ email: 'ovrnivel@nivel.gen.test' })
    await setNivelPadrao(userId, 'iniciante')

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), nivel: 'avancado' },
      headers,
    )
    expect(res.status).toBe(201)

    const stamp = await lastStamp(userId)
    expect(stamp?.axes).toEqual({ nivelChef: 'avancado' })
  })

  it('sem default e sem override ⇒ eixo NEUTRO (axes vazio)', async () => {
    await seedVocabularyCozinhas(getDb())
    setClaudeClient(new FakeClaudeClient((t) => t, cannedSuccess()))
    const { userId, headers } = await seedSessionHeaders({ email: 'neutro@nivel.gen.test' })

    const res = await post({ mode: 'structured', briefing: makeBriefing({ cozinha: null }) }, headers)
    expect(res.status).toBe(201)

    const stamp = await lastStamp(userId)
    expect(stamp?.axes).toEqual({})
  })

  it('override inválido no body é IGNORADO → cai no default do Perfil', async () => {
    await seedVocabularyCozinhas(getDb())
    setClaudeClient(new FakeClaudeClient((t) => t, cannedSuccess()))
    const { userId, headers } = await seedSessionHeaders({ email: 'badovr@nivel.gen.test' })
    await setNivelPadrao(userId, 'intermediario')

    const res = await post(
      { mode: 'structured', briefing: makeBriefing({ cozinha: null }), nivel: 'expert' },
      headers,
    )
    expect(res.status).toBe(201)

    const stamp = await lastStamp(userId)
    expect(stamp?.axes).toEqual({ nivelChef: 'intermediario' })
  })
})
