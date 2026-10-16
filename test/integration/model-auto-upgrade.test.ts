import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDb, setModelCatalog } from '@/server/deps'
import { appConfig } from '@/db/schema'
import { loadAppConfig } from '@/server/app-config'
import { autoUpgradeModels } from '@/server/claude/model-auto-upgrade'
import type { CatalogModel } from '@/domain/claude-models'
import { EFFORT_LEVELS, type ModelSettings } from '@/domain/ai-task-config'
import type { ModelCatalog } from '@/server/claude/model-catalog'
import type { ModelProbe, ProbeResult } from '@/server/claude/model-probe'
import { GET as cronGet } from '@/app/api/cron/ai-models/route'

/**
 * Troca automática de versão (ADR-0046): o cron diário leva cada tarefa ao
 * mais novo da MESMA família, só depois de uma chamada de teste aceita, e nunca atropela o admin.
 */

const ALL = { effort: [...EFFORT_LEVELS], adaptiveThinking: true }
const model = (id: string, createdAt: string): CatalogModel => ({ id, displayName: id, createdAt, capabilities: ALL })

// Hoje: Opus 5.5, Sonnet 5.5 e Haiku 5.5; "amanhã" sai um Sonnet 6.
const TODAY = [
  model('claude-opus-5-5', '2026-08-10T00:00:00Z'),
  model('claude-sonnet-5-5', '2026-09-20T00:00:00Z'),
  model('claude-haiku-5-5', '2026-10-01T00:00:00Z'),
  model('claude-sonnet-5', '2026-05-01T00:00:00Z'),
]
const WITH_SONNET_6 = [model('claude-sonnet-6', '2026-11-01T00:00:00Z'), ...TODAY]

const catalogOf = (list: CatalogModel[] | Error): ModelCatalog => ({
  listModels: async () => {
    if (list instanceof Error) throw list
    return list
  },
})

/** Dublê da chamada de teste: recusa `disabled` no Sonnet 6 (como o Sonnet 5.5), aceita o resto. */
function probe(override?: (model: string, s: ModelSettings) => ProbeResult | undefined) {
  const calls: Array<{ model: string; settings: ModelSettings }> = []
  const p: ModelProbe = {
    probe: async (m, settings) => {
      calls.push({ model: m, settings })
      const forced = override?.(m, settings)
      if (forced) return forced
      if (m === 'claude-sonnet-6' && settings.thinking === 'off') {
        return { kind: 'rejected', message: '"thinking.type.disabled" is not supported for this model.' }
      }
      return { kind: 'ok' }
    },
  }
  return { p, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('autoUpgradeModels', () => {
  it('nada novo na família ⇒ não testa nem grava', async () => {
    const { p, calls } = probe()
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(TODAY), probe: p })
    expect(out.kind).toBe('ok')
    expect(calls).toEqual([])
    expect(await getDb().select().from(appConfig)).toHaveLength(0)
  })

  it('versão nova da família ⇒ testa, desce a escada até um ajuste aceito e grava modelo + ajuste', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await getDb()
      .insert(appConfig)
      .values({
        id: true,
        aiTasks: {
          translation: { model: 'claude-sonnet-5-5', byModel: { 'claude-sonnet-5-5': { effort: null, thinking: 'off' } } },
        },
      })
    const { p, calls } = probe()
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: p })

    // Tradução: `off` recusado, `betweenTools` aceito.
    expect(calls.filter((c) => c.model === 'claude-sonnet-6').slice(0, 2)).toEqual([
      { model: 'claude-sonnet-6', settings: { effort: null, thinking: 'off' } },
      { model: 'claude-sonnet-6', settings: { effort: null, thinking: 'betweenTools' } },
    ])
    const cfg = await loadAppConfig(getDb())
    expect(cfg.aiTasks.translation.model).toBe('claude-sonnet-6')
    expect(cfg.aiTasks.translation.byModel['claude-sonnet-6']).toEqual({ effort: null, thinking: 'betweenTools' })
    // O ajuste do modelo anterior continua guardado (voltar a ele recupera o ajuste).
    expect(cfg.aiTasks.translation.byModel['claude-sonnet-5-5']).toEqual({ effort: null, thinking: 'off' })
    // As outras tarefas no Sonnet (default) também sobem; a Geração (Opus) não muda de família.
    expect(cfg.aiTasks.extraction.model).toBe('claude-sonnet-6')
    expect(cfg.aiTasks.menu.model).toBe('claude-sonnet-6')
    expect(cfg.defaultModel).toBe('claude-opus-5-5')
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'generation')?.kind).toBe('atual')
    // Sonnet 6 não está na tabela de preço: avisa no log.
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('claude-sonnet-6 sem preço'))
  })

  it('Geração troca a coluna default_model', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await getDb().insert(appConfig).values({ id: true, defaultModel: 'claude-sonnet-5' })
    const { p } = probe()
    await autoUpgradeModels(getDb(), { catalog: catalogOf(TODAY), probe: p })
    const cfg = await loadAppConfig(getDb())
    expect(cfg.defaultModel).toBe('claude-sonnet-5-5')
    expect(cfg.aiTasks.generation.byModel['claude-sonnet-5-5']).toEqual({ effort: 'medium', thinking: 'default' })
  })

  it('interruptor desligado ⇒ fica onde está, sem chamada de teste', async () => {
    await getDb()
      .insert(appConfig)
      .values({ id: true, aiTasks: Object.fromEntries(['translation', 'extraction', 'menu', 'imageScene', 'generation'].map((t) => [t, { auto: false }])) })
    const { p, calls } = probe()
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: p })
    expect(calls).toEqual([])
    expect(out.kind === 'ok' && out.outcomes.every((o) => o.kind === 'fixo')).toBe(true)
    expect((await loadAppConfig(getDb())).aiTasks.translation.model).toBe('claude-sonnet-5-5')
  })

  it('todos os ajustes recusados ⇒ fica no atual e loga', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { p } = probe(() => ({ kind: 'rejected', message: 'não' }))
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: p })
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'translation')?.kind).toBe('recusado')
    expect((await loadAppConfig(getDb())).aiTasks.translation.model).toBe('claude-sonnet-5-5')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('recusou todos os ajustes'))
  })

  it('teste indisponível ⇒ fica no atual (tenta amanhã)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { p, calls } = probe(() => ({ kind: 'unavailable' }))
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: p })
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'menu')?.kind).toBe('semTeste')
    // O primeiro "indisponível" para a passada inteira (a API provavelmente está fora).
    expect(calls).toHaveLength(1)
    expect(out.kind === 'ok' && out.outcomes.filter((o) => o.kind === 'semTeste')).toHaveLength(4)
    expect((await loadAppConfig(getDb())).aiTasks.menu.model).toBe('claude-sonnet-5-5')
  })

  it('Models API fora ⇒ nada muda (nunca troca pela lista pinada)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { p, calls } = probe()
    expect(await autoUpgradeModels(getDb(), { catalog: catalogOf(new Error('rede')), probe: p })).toEqual({
      kind: 'semLista',
    })
    expect(calls).toEqual([])
  })

  it('admin salvou outro modelo durante os testes ⇒ não atropela', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { p } = probe()
    // Simula o admin gravando a Tradução no Opus enquanto a chamada de teste roda.
    const racing: ModelProbe = {
      probe: async (m, s) => {
        await getDb()
          .insert(appConfig)
          .values({ id: true, aiTasks: { translation: { model: 'claude-opus-5-5' } } })
          .onConflictDoNothing()
        return p.probe(m, s)
      },
    }
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: racing })
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'translation')?.kind).toBe('mudouNoMeio')
    expect((await loadAppConfig(getDb())).aiTasks.translation.model).toBe('claude-opus-5-5')
  })

  it('nunca rebaixa: em uso fora da lista e "mais novo" listado mais antigo ⇒ fica', async () => {
    await getDb()
      .insert(appConfig)
      .values({ id: true, aiTasks: { translation: { model: 'claude-haiku-6' } } })
    const { p, calls } = probe()
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(TODAY), probe: p })
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'translation')?.kind).toBe('naoMaisNovo')
    expect(calls.some((c) => c.model === 'claude-haiku-5-5')).toBe(false)
    expect((await loadAppConfig(getDb())).aiTasks.translation.model).toBe('claude-haiku-6')
  })

  it('em uso aposentado (fora da lista) com versão menor ⇒ sobe para o mais novo da família', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    await getDb()
      .insert(appConfig)
      .values({ id: true, aiTasks: { translation: { model: 'claude-sonnet-4-6' } } })
    const { p } = probe()
    await autoUpgradeModels(getDb(), { catalog: catalogOf(TODAY), probe: p })
    expect((await loadAppConfig(getDb())).aiTasks.translation.model).toBe('claude-sonnet-5-5')
  })

  it('tarefas que sobem para o mesmo modelo dividem o resultado do teste', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { p, calls } = probe()
    await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: p })
    const keys = calls.map((c) => `${c.model}|${c.settings.effort}|${c.settings.thinking}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('orçamento de tempo esgotado ⇒ não começa teste novo e a tarefa fica (semTempo)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    let clock = 0
    const { p, calls } = probe()
    const slow: ModelProbe = {
      probe: async (m, s) => {
        clock += 40_000
        return p.probe(m, s)
      },
    }
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(WITH_SONNET_6), probe: slow, now: () => clock })
    // Só a 1ª chamada começa no orçamento; a Extração reaproveita o resultado (mesmo modelo e ajuste).
    expect(calls).toHaveLength(1)
    const kinds = out.kind === 'ok' ? Object.fromEntries(out.outcomes.map((o) => [o.task, o.kind])) : {}
    expect(kinds).toMatchObject({ translation: 'trocado', extraction: 'trocado', menu: 'semTempo', imageScene: 'semTempo' })
  })

  it('modelo fora das famílias (Fable legado) não é tocado', async () => {
    await getDb().insert(appConfig).values({ id: true, defaultModel: 'claude-fable-5-1' })
    const { p } = probe()
    const out = await autoUpgradeModels(getDb(), { catalog: catalogOf(TODAY), probe: p })
    expect(out.kind === 'ok' && out.outcomes.find((o) => o.task === 'generation')?.kind).toBe('foraDaFamilia')
    expect((await loadAppConfig(getDb())).defaultModel).toBe('claude-fable-5-1')
  })
})

describe('GET /api/cron/ai-models', () => {
  it('com o segredo: roda a passada, responde o resumo e loga a linha final', async () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    setModelCatalog(catalogOf(TODAY))
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const res = await cronGet(
      new Request('http://localhost/api/cron/ai-models', { headers: { authorization: 'Bearer s3cret' } }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kind).toBe('ok')
    expect(info).toHaveBeenCalledWith(expect.stringContaining('[ai-models] passada concluída: atual=5'))
    vi.unstubAllEnvs()
  })

  it('fail-closed: sem CRON_SECRET ou com header errado ⇒ 401', async () => {
    vi.stubEnv('CRON_SECRET', '')
    expect((await cronGet(new Request('http://localhost/api/cron/ai-models'))).status).toBe(401)
    vi.stubEnv('CRON_SECRET', 's3cret')
    const wrong = new Request('http://localhost/api/cron/ai-models', { headers: { authorization: 'Bearer nope' } })
    expect((await cronGet(wrong)).status).toBe(401)
    vi.unstubAllEnvs()
  })
})
