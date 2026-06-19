import { afterAll, beforeAll, describe, expect, it, inject } from 'vitest'
import type { Sql } from 'postgres'
import { makeSql } from '@/db/client'
import { POST } from '@/app/api/parse-ingredients/route'
import { setClaudeClient } from '@/server/deps'
import { FakeClaudeClient, type ClaudeClient } from '@/server/claude/client'
import type { ExtractionOutput } from '@/domain/ingredient-extraction'
import { seedSessionHeaders } from '../helpers/users'

/**
 * Contrato da Extração de ingredientes (#112) pela porta mais alta: POST /api/parse-ingredients
 * contra a sessão real (better-auth) + o seam do Claude trocado por
 * `FakeClaudeClient(reply, canned, cannedTokens, cannedExtraction)` — o 4º arg enlata o
 * ExtractionOutput. `setup.ts` faz `resetDeps()` + `truncateAll` antes de cada teste.
 *
 * A rota NÃO escreve no banco (a Extração só organiza o texto do Usuário), então não há
 * contagens de tabela — o foco é gating, validação, normalização de unidade e parse_failed.
 */

let sql: Sql

beforeAll(() => {
  sql = makeSql(inject('databaseUrl'))
})

afterAll(async () => {
  await sql?.end({ timeout: 5 })
})

/** POST /api/parse-ingredients com corpo JSON (+ headers de sessão opcionais). */
function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/parse-ingredients', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

/** Injeta o seam com SÓ o ExtractionOutput enlatado (4º arg). */
function setExtraction(out: ExtractionOutput): void {
  setClaudeClient(new FakeClaudeClient(undefined, undefined, undefined, out))
}

/** Cliente que ESTOURA se o seam for tocado — prova que a validação curto-circuitou antes. */
class ExplodingClaudeClient implements ClaudeClient {
  async echo(): Promise<string> {
    throw new Error('ExplodingClaudeClient.echo não devia ser chamado')
  }
  async generateRecipe(): Promise<never> {
    throw new Error('seam tocado: generateRecipe não devia ser chamado')
  }
  async *streamConversation(): AsyncIterable<string> {
    throw new Error('seam tocado: streamConversation não devia ser chamado')
  }
  async extractIngredients(): Promise<never> {
    throw new Error('seam tocado: a entrada devia ter sido rejeitada ANTES da extração')
  }
}

describe('POST /api/parse-ingredients — Extração de ingredientes (#112)', () => {
  it('anon (sem headers) → 401; o seam NUNCA é tocado (fail-closed)', async () => {
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ rawInput: '2 cebolas, sal a gosto' })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })

  it('rawInput curto demais (< 10) → 400 entrada_vazia; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'short@parse.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ rawInput: 'oi' }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'entrada_vazia' })
  })

  it('rawInput ausente/não-string → 400 entrada_vazia', async () => {
    const { headers } = await seedSessionHeaders({ email: 'missing@parse.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({}, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'entrada_vazia' })
  })

  it('rawInput longo demais (> 500) → 400 entrada_muito_longa; seam intocado', async () => {
    const { headers } = await seedSessionHeaders({ email: 'long@parse.test' })
    setClaudeClient(new ExplodingClaudeClient())

    const res = await post({ rawInput: 'a'.repeat(501) }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'entrada_muito_longa' })
  })

  it('happy-path → 200 com itens normalizados (unidade reconhecida preservada)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'ok@parse.test' })
    setExtraction({
      kind: 'ok',
      items: [
        { rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' },
        { rawText: 'salsinha', quantidade: null, unidade: null, strength: 'preferred' },
      ],
    })

    const res = await post({ rawInput: '2 cebolas, salsinha a gosto se quiser' }, headers)
    expect(res.status).toBe(200)
    const json = (await res.json()) as {
      items: { rawText: string; quantidade: string | null; unidade: string | null; strength: string }[]
    }
    expect(json.items).toEqual([
      { rawText: 'cebola', quantidade: '2', unidade: 'unidade', strength: 'required' },
      { rawText: 'salsinha', quantidade: null, unidade: null, strength: 'preferred' },
    ])
  })

  it('unidade fora do vocabulário → normalizada para null (isUnidade é o gate único)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'unit@parse.test' })
    setExtraction({
      kind: 'ok',
      items: [{ rawText: 'leite', quantidade: '1', unidade: 'galao', strength: 'required' }],
    })

    const res = await post({ rawInput: '1 galão de leite integral' }, headers)
    expect(res.status).toBe(200)
    const json = (await res.json()) as { items: { unidade: string | null }[] }
    expect(json.items[0].unidade).toBeNull()
  })

  it('parse_failed do seam → 502 extracao_falhou', async () => {
    const { headers } = await seedSessionHeaders({ email: 'fail@parse.test' })
    setExtraction({ kind: 'parse_failed' })

    const res = await post({ rawInput: 'algo que o modelo não conseguiu parsear' }, headers)
    expect(res.status).toBe(502)
    await expect(res.json()).resolves.toMatchObject({ error: 'extracao_falhou' })
  })
})
