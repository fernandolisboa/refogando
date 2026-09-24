import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_TEXT_MODEL,
  FALLBACK_SELECTABLE_MODELS,
  latestPerFamily,
  selectableFamilyOf,
  type CatalogModel,
} from '@/domain/claude-models'
import {
  FAILURE_TTL_MS,
  RealModelCatalog,
  SUCCESS_TTL_MS,
  loadSelectableModels,
} from '@/server/claude/model-catalog'

const m = (id: string, createdAt: string): CatalogModel => ({ id, displayName: id, createdAt })

describe('selectableFamilyOf', () => {
  it('reconhece Opus, Sonnet e Fable; Haiku, Mythos e lixo ficam de fora', () => {
    expect(selectableFamilyOf('claude-opus-5-5')).toBe('opus')
    expect(selectableFamilyOf('claude-sonnet-5')).toBe('sonnet')
    expect(selectableFamilyOf('claude-fable-5-1')).toBe('fable')
    expect(selectableFamilyOf('claude-haiku-4-5')).toBeNull()
    expect(selectableFamilyOf('claude-mythos-5-1')).toBeNull()
    expect(selectableFamilyOf('gpt-4')).toBeNull()
  })
})

describe('latestPerFamily', () => {
  it('fica com o mais novo de cada família, na ordem opus → sonnet → fable, independente da ordem de entrada', () => {
    const out = latestPerFamily([
      m('claude-sonnet-4-6', '2026-02-01T00:00:00Z'),
      m('claude-opus-4-8', '2026-04-01T00:00:00Z'),
      m('claude-fable-5', '2026-05-15T00:00:00Z'),
      m('claude-opus-5-5', '2026-08-10T00:00:00Z'),
      m('claude-haiku-4-5', '2026-09-01T00:00:00Z'),
      m('claude-sonnet-5', '2026-05-01T00:00:00Z'),
      m('claude-fable-5-1', '2026-08-20T00:00:00Z'),
    ])
    expect(out.map((o) => o.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-fable-5-1'])
    expect(out.map((o) => o.family)).toEqual(['opus', 'sonnet', 'fable'])
  })

  it('família ausente na lista fica de fora; lista vazia ⇒ []', () => {
    expect(latestPerFamily([m('claude-opus-5-5', '2026-08-10T00:00:00Z')]).map((o) => o.id)).toEqual([
      'claude-opus-5-5',
    ])
    expect(latestPerFamily([])).toEqual([])
  })

  it('data inválida não vence uma data válida', () => {
    const out = latestPerFamily([m('claude-opus-x', 'lixo'), m('claude-opus-5-5', '2026-08-10T00:00:00Z')])
    expect(out[0].id).toBe('claude-opus-5-5')
  })
})

describe('loadSelectableModels', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lista viva ⇒ source live', async () => {
    const out = await loadSelectableModels({ listModels: async () => [m('claude-opus-5-5', '2026-08-10T00:00:00Z')] })
    expect(out).toEqual({ models: [{ id: 'claude-opus-5-5', displayName: 'claude-opus-5-5', family: 'opus' }], source: 'live' })
  })

  it('erro da Models API ⇒ lista pinada + log só com metadados', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const out = await loadSelectableModels({
      listModels: async () => {
        throw Object.assign(new Error('sem chave'), { status: 401 })
      },
    })
    expect(out).toEqual({ models: FALLBACK_SELECTABLE_MODELS, source: 'fallback' })
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Models API'), { name: 'Error', status: 401 })
  })

  it('lista sem nenhuma família nossa ⇒ lista pinada', async () => {
    const out = await loadSelectableModels({ listModels: async () => [m('claude-haiku-4-5', '2026-01-01T00:00:00Z')] })
    expect(out).toEqual({ models: FALLBACK_SELECTABLE_MODELS, source: 'fallback' })
  })

  it('o default em código é selecionável no fallback', () => {
    expect(FALLBACK_SELECTABLE_MODELS.some((o) => o.id === DEFAULT_TEXT_MODEL)).toBe(true)
  })
})

describe('RealModelCatalog — cache', () => {
  function setup(results: Array<CatalogModel[] | Error>) {
    let clock = 0
    const fetchAll = vi.fn(async () => {
      const next = results.shift()!
      if (next instanceof Error) throw next
      return next
    })
    const catalog = new RealModelCatalog(fetchAll, () => clock)
    return { catalog, fetchAll, advance: (ms: number) => (clock += ms) }
  }
  const LIST = [m('claude-opus-5-5', '2026-08-10T00:00:00Z')]

  it('sucesso vale 1h; chamadas concorrentes dividem uma só busca', async () => {
    const { catalog, fetchAll, advance } = setup([LIST, LIST])
    await Promise.all([catalog.listModels(), catalog.listModels()])
    advance(SUCCESS_TTL_MS - 1)
    await catalog.listModels()
    expect(fetchAll).toHaveBeenCalledTimes(1)
    advance(1)
    await catalog.listModels()
    expect(fetchAll).toHaveBeenCalledTimes(2)
  })

  it('falha vale só 5 min (não 1h)', async () => {
    const { catalog, fetchAll, advance } = setup([new Error('rede'), LIST])
    await expect(catalog.listModels()).rejects.toThrow('rede')
    advance(FAILURE_TTL_MS - 1)
    await expect(catalog.listModels()).rejects.toThrow('rede')
    expect(fetchAll).toHaveBeenCalledTimes(1)
    advance(1)
    await expect(catalog.listModels()).resolves.toEqual(LIST)
    expect(fetchAll).toHaveBeenCalledTimes(2)
  })
})
