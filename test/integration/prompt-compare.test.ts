import { describe, it, expect, beforeEach } from 'vitest'
import { POST } from '@/app/api/admin/prompt-compare/route'
import { runComparison } from '@/server/generation/compare'
import { seedSessionHeaders } from '../helpers/users'
import { setClaudeClient, setImageGenerator, resetDeps } from '@/server/deps'
import { FakeClaudeClient } from '@/server/claude/client'
import { FakeImageGenerator } from '@/server/images/image-generator'
import { cannedSuccess, cannedImpossible } from '../helpers/generation'
import {
  FIXED_BRIEFINGS,
  BASELINE_SYSTEM_PROMPTS,
  type ComparisonResponse,
} from '@/domain/prompt-comparator'
import { buildSystemPrompt } from '@/domain/briefing'

/**
 * Comparador de prompt (#425, ADR-0029 dec.7) — runner `runComparison` + rota `POST
 * /api/admin/prompt-compare`. Sem rede: FakeClaudeClient + FakeImageGenerator injetados. Prova:
 *  - runner devolve DTO puro (Receita + imagem opt-in); impossible ⇒ recipe null + sem imagem.
 *  - o lado 'old' usa o systemPrompt BASELINE; 'new' usa o `buildSystemPrompt` vivo.
 *  - gating admin-only da rota (espelha o probe): curador → 403, anon → 401; admin → 200.
 *  - fixtureIndex fora da faixa → 400 sem tocar o seam.
 */

beforeEach(() => {
  resetDeps()
})

function post(body: unknown, headers?: Headers): Promise<Response> {
  return POST(
    new Request('http://localhost/api/admin/prompt-compare', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  )
}

describe('runComparison — DTO puro, sem persistência', () => {
  it('sucesso: devolve Receita; texto-só (sem imagem) por default', async () => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    const img = new FakeImageGenerator()
    setImageGenerator(img)

    const fixture = FIXED_BRIEFINGS[0]
    const res = await runComparison(fixture, 'new', { model: 'claude-opus-4-8', withImage: false })
    expect(res.side).toBe('new')
    expect(res.outcome).toBe('success')
    expect(res.recipe).not.toBeNull()
    expect(res.imageDataUrl).toBeNull()
    expect(img.calls).toBe(0) // withImage=false ⇒ o gerador de imagem NÃO é tocado
    expect(res.systemPrompt).toBe(buildSystemPrompt(fixture.mode, fixture.axes))
  })

  it('withImage: gera a imagem do prato como data URL', async () => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    const img = new FakeImageGenerator()
    setImageGenerator(img)

    const res = await runComparison(FIXED_BRIEFINGS[0], 'new', {
      model: 'claude-opus-4-8',
      withImage: true,
    })
    expect(img.calls).toBe(1)
    expect(res.imageDataUrl).toMatch(/^data:image\/png;base64,/)
  })

  it("lado 'old' usa o systemPrompt BASELINE congelado", async () => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setImageGenerator(new FakeImageGenerator())
    const fixture = FIXED_BRIEFINGS[0]
    const res = await runComparison(fixture, 'old', { model: 'claude-opus-4-8', withImage: false })
    expect(res.systemPrompt).toBe(BASELINE_SYSTEM_PROMPTS[fixture.mode])
  })

  it('impossible: sem Receita e sem imagem, mesmo com withImage', async () => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedImpossible('Não dá.')))
    const img = new FakeImageGenerator()
    setImageGenerator(img)
    const res = await runComparison(FIXED_BRIEFINGS[0], 'new', {
      model: 'claude-opus-4-8',
      withImage: true,
    })
    expect(res.outcome).toBe('impossible')
    expect(res.recipe).toBeNull()
    expect(res.imageDataUrl).toBeNull()
    expect(res.advisory).toBe('Não dá.')
    expect(img.calls).toBe(0) // sem Receita ⇒ imagem nunca é gerada
  })
})

describe('POST /api/admin/prompt-compare — gating admin-only (espelha o probe)', () => {
  it('Usuário → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cmp-user@425.test', role: 'usuario' })
    expect((await post({ fixtureIndex: 0 }, headers)).status).toBe(403)
  })

  it('Curador → 403', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cmp-cur@425.test', role: 'curador' })
    expect((await post({ fixtureIndex: 0 }, headers)).status).toBe(403)
  })

  it('sem sessão → 401', async () => {
    const res = await post({ fixtureIndex: 0 })
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toMatchObject({ error: 'nao_autenticado' })
  })
})

describe('POST /api/admin/prompt-compare — admin roda os dois lados de uma fixture', () => {
  it('Admin → 200 com old+new da fixture', async () => {
    setClaudeClient(new FakeClaudeClient(undefined, cannedSuccess()))
    setImageGenerator(new FakeImageGenerator())
    const { headers } = await seedSessionHeaders({ email: 'cmp-adm@425.test', role: 'admin' })
    const res = await post({ fixtureIndex: 1, withImage: false }, headers)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ComparisonResponse
    expect(body.fixtureId).toBe(FIXED_BRIEFINGS[1].id)
    expect(body.old.side).toBe('old')
    expect(body.new.side).toBe('new')
    expect(body.new.recipe).not.toBeNull()
  })

  it('fixtureIndex fora da faixa → 400 fixture_invalida (seam não tocado)', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cmp-oob@425.test', role: 'admin' })
    const res = await post({ fixtureIndex: 999 }, headers)
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toMatchObject({ error: 'fixture_invalida' })
  })

  it('fixtureIndex ausente/não-inteiro → 400', async () => {
    const { headers } = await seedSessionHeaders({ email: 'cmp-bad@425.test', role: 'admin' })
    expect((await post({}, headers)).status).toBe(400)
    expect((await post({ fixtureIndex: 1.5 }, headers)).status).toBe(400)
  })
})
