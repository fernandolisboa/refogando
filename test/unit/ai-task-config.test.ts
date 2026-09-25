import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import {
  TASK_DEFAULT_SETTINGS,
  activeSettings,
  maxTokensFor,
  parseModelSettings,
  parseStoredAiTasks,
  resolveAiTasks,
  settingsForModel,
  tuningParams,
  withTaskSettings,
  type ModelSettings,
} from '@/domain/ai-task-config'
import type { CatalogModel, ModelOption } from '@/domain/claude-models'
import { capsOf } from '@/server/claude/model-catalog'
import { fitsCapabilities, isAcceptableModel, validateAiTaskUpdate } from '@/server/claude/ai-task-update'
import type { ModelProbe, ProbeResult } from '@/server/claude/model-probe'

/**
 * Config de IA por tarefa (ADR-0034): regras puras (parse, resolução, ajuste por modelo, parâmetros
 * de request) + os três portões do salvar (modelo oferecível, capacidades, chamada de teste).
 */

const ON: ModelSettings = { effort: 'high', thinking: 'adaptive' }
const OFF: ModelSettings = { effort: null, thinking: 'off' }

describe('parseModelSettings', () => {
  it('aceita níveis e modos conhecidos; effort ausente vira null', () => {
    expect(parseModelSettings({ effort: 'xhigh', thinking: 'default' })).toEqual({ effort: 'xhigh', thinking: 'default' })
    expect(parseModelSettings({ thinking: 'off' })).toEqual({ effort: null, thinking: 'off' })
  })

  it('recusa nível/modo desconhecido e não-objeto', () => {
    expect(parseModelSettings({ effort: 'turbo', thinking: 'off' })).toBeNull()
    expect(parseModelSettings({ effort: 'low', thinking: 'enabled' })).toBeNull()
    expect(parseModelSettings({ effort: 'low' })).toBeNull()
    expect(parseModelSettings(null)).toBeNull()
    expect(parseModelSettings('off')).toBeNull()
  })
})

describe('parseStoredAiTasks', () => {
  it('descarta por item o que for inválido, nunca lança', () => {
    const parsed = parseStoredAiTasks({
      translation: {
        model: 'claude-sonnet-5',
        byModel: { 'claude-sonnet-5': OFF, 'claude-opus-5-5': { thinking: 'bogus' }, 'bad id!': OFF },
      },
      extraction: { model: 42 },
      unknown: { model: 'claude-opus-5-5' },
    })
    expect(parsed).toEqual({
      translation: { model: 'claude-sonnet-5', byModel: { 'claude-sonnet-5': OFF } },
      extraction: {},
    })
  })

  it('lixo no topo ⇒ vazio', () => {
    expect(parseStoredAiTasks(null)).toEqual({})
    expect(parseStoredAiTasks('x')).toEqual({})
  })
})

describe('resolveAiTasks + activeSettings', () => {
  const fallbacks = { generation: 'claude-opus-5-5', translation: 'claude-sonnet-5', extraction: 'claude-sonnet-5' }

  it('Geração sempre usa o modelo de fora (coluna); Tradução/Extração usam o jsonb quando tem', () => {
    const cfg = resolveAiTasks(
      { generation: { model: 'claude-fable-5-1' }, extraction: { model: 'claude-opus-5-5' } },
      fallbacks,
    )
    expect(cfg.generation.model).toBe('claude-opus-5-5')
    expect(cfg.translation.model).toBe('claude-sonnet-5')
    expect(cfg.extraction.model).toBe('claude-opus-5-5')
  })

  it('sem ajuste salvo para o modelo em uso ⇒ default da tarefa', () => {
    const cfg = resolveAiTasks({ translation: { byModel: { 'claude-opus-5-5': ON } } }, fallbacks)
    expect(activeSettings('translation', cfg.translation)).toEqual(TASK_DEFAULT_SETTINGS.translation)
    expect(activeSettings('generation', cfg.generation)).toEqual({ effort: 'medium', thinking: 'default' })
  })
})

describe('withTaskSettings', () => {
  it('guarda o ajuste por modelo sem apagar o dos outros modelos', () => {
    let stored = withTaskSettings({}, 'extraction', 'claude-sonnet-5', OFF)
    stored = withTaskSettings(stored, 'extraction', 'claude-opus-5-5', ON)
    expect(stored.extraction).toEqual({
      model: 'claude-opus-5-5',
      byModel: { 'claude-sonnet-5': OFF, 'claude-opus-5-5': ON },
    })
  })

  it('Geração não grava o modelo no jsonb (ele mora em default_model)', () => {
    expect(withTaskSettings({}, 'generation', 'claude-fable-5-1', ON)).toEqual({
      generation: { byModel: { 'claude-fable-5-1': ON } },
    })
  })

  it('tem teto de entradas por tarefa (descarta as mais antigas)', () => {
    let stored = {}
    for (let i = 0; i < 55; i++) stored = withTaskSettings(stored, 'translation', `claude-sonnet-${i}`, OFF)
    const byModel = parseStoredAiTasks(stored).translation!.byModel!
    expect(Object.keys(byModel)).toHaveLength(50)
    expect(byModel['claude-sonnet-0']).toBeUndefined()
    expect(byModel['claude-sonnet-54']).toEqual(OFF)
  })
})

describe('tuningParams + maxTokensFor', () => {
  it('default/null não mandam parâmetro; adaptive/off/effort viram o formato da API', () => {
    expect(tuningParams({ effort: null, thinking: 'default' })).toEqual({})
    expect(tuningParams(ON)).toEqual({ thinking: { type: 'adaptive' }, effort: 'high' })
    expect(tuningParams(OFF)).toEqual({ thinking: { type: 'disabled' } })
  })

  it('thinking que pode ligar ganha folga de tokens; desligado fica no teto base', () => {
    expect(maxTokensFor(4000, OFF)).toBe(4000)
    expect(maxTokensFor(4000, ON)).toBeGreaterThan(4000)
    expect(maxTokensFor(4000, { effort: null, thinking: 'default' })).toBeGreaterThan(4000)
  })
})

describe('settingsForModel', () => {
  it('lê do jsonb cru; sem entrada ⇒ default da tarefa', () => {
    const raw = { generation: { byModel: { 'claude-fable-5-1': ON } } }
    expect(settingsForModel('generation', raw, 'claude-fable-5-1')).toEqual(ON)
    expect(settingsForModel('generation', raw, 'claude-opus-5-5')).toEqual(TASK_DEFAULT_SETTINGS.generation)
    expect(settingsForModel('generation', 'lixo', 'claude-opus-5-5')).toEqual(TASK_DEFAULT_SETTINGS.generation)
  })
})

describe('capsOf', () => {
  const sup = (supported: boolean) => ({ supported })
  it('recorta esforço suportado e thinking adaptativo da Models API', () => {
    const raw = {
      effort: { supported: true, low: sup(true), medium: sup(true), high: sup(true), xhigh: sup(false), max: sup(true) },
      thinking: { supported: true, types: { adaptive: sup(true), enabled: sup(false) } },
    } as unknown as Anthropic.ModelCapabilities
    expect(capsOf(raw)).toEqual({ effort: ['low', 'medium', 'high', 'max'], adaptiveThinking: true })
  })

  it('sem esforço/thinking suportados ⇒ listas vazias; sem bloco ⇒ null', () => {
    const raw = {
      effort: { supported: false },
      thinking: { supported: false, types: { adaptive: sup(true) } },
    } as unknown as Anthropic.ModelCapabilities
    expect(capsOf(raw)).toEqual({ effort: [], adaptiveThinking: false })
    expect(capsOf(null)).toBeNull()
    expect(capsOf(undefined)).toBeNull()
  })
})

describe('fitsCapabilities', () => {
  const opt = (caps: ModelOption['capabilities']): ModelOption => ({
    id: 'claude-sonnet-5',
    displayName: 'Claude Sonnet 5',
    family: 'sonnet',
    capabilities: caps,
  })

  it('recusa esforço fora da lista e adaptive sem suporte; sem capacidades ⇒ passa', () => {
    const caps = { effort: ['low' as const, 'medium' as const], adaptiveThinking: false }
    expect(fitsCapabilities(opt(caps), { effort: 'low', thinking: 'off' })).toBe(true)
    expect(fitsCapabilities(opt(caps), { effort: 'max', thinking: 'off' })).toBe(false)
    expect(fitsCapabilities(opt(caps), { effort: null, thinking: 'adaptive' })).toBe(false)
    expect(fitsCapabilities(opt(null), ON)).toBe(true)
    expect(fitsCapabilities(undefined, ON)).toBe(true)
  })
})

describe('isAcceptableModel', () => {
  const live = {
    source: 'live' as const,
    models: [{ id: 'claude-opus-5-5', displayName: 'Opus', family: 'opus' as const, capabilities: null }],
  }
  const fallback = { ...live, source: 'fallback' as const }

  it('lista viva: só o listado ou o que já está em uso', () => {
    expect(isAcceptableModel('claude-opus-5-5', 'x', live)).toBe(true)
    expect(isAcceptableModel('claude-sonnet-4-6', 'claude-sonnet-4-6', live)).toBe(true)
    expect(isAcceptableModel('claude-sonnet-6', 'x', live)).toBe(false)
  })

  it('fallback: aceita família selecionável no formato atual, nunca Haiku ou lixo', () => {
    expect(isAcceptableModel('claude-sonnet-6', 'x', fallback)).toBe(true)
    expect(isAcceptableModel('claude-haiku-5', 'x', fallback)).toBe(false)
    expect(isAcceptableModel('claude-opus-5-5-evil', 'x', fallback)).toBe(false)
  })
})

describe('validateAiTaskUpdate', () => {
  const catalogModel: CatalogModel = {
    id: 'claude-opus-5-5',
    displayName: 'Claude Opus 5.5',
    createdAt: '2026-08-10T00:00:00Z',
    capabilities: { effort: ['low', 'medium', 'high'], adaptiveThinking: true },
  }
  const catalog = { listModels: async () => [catalogModel] }
  const probeOf = (result: ProbeResult): ModelProbe & { calls: number } => {
    const p = {
      calls: 0,
      probe: async () => {
        p.calls++
        return result
      },
    }
    return p
  }

  it('forma inválida ⇒ config_invalida, sem chamada de teste', async () => {
    const probe = probeOf({ kind: 'ok' })
    expect(await validateAiTaskUpdate(null, 'x', { catalog, probe })).toEqual({ ok: false, error: 'config_invalida' })
    expect(
      await validateAiTaskUpdate({ model: 'claude-opus-5-5', settings: { thinking: 'x' } }, 'x', { catalog, probe }),
    ).toEqual({ ok: false, error: 'config_invalida' })
    expect(probe.calls).toBe(0)
  })

  it('modelo fora da lista ⇒ modelo_invalido; ajuste fora das capacidades ⇒ ajuste_nao_suportado', async () => {
    const probe = probeOf({ kind: 'ok' })
    const deps = { catalog, probe }
    expect(await validateAiTaskUpdate({ model: 'claude-haiku-4-5', settings: OFF }, 'x', deps)).toEqual({
      ok: false,
      error: 'modelo_invalido',
    })
    expect(
      await validateAiTaskUpdate({ model: 'claude-opus-5-5', settings: { effort: 'max', thinking: 'default' } }, 'x', deps),
    ).toEqual({ ok: false, error: 'ajuste_nao_suportado' })
    expect(probe.calls).toBe(0)
  })

  it('a Anthropic recusa na chamada de teste ⇒ ajuste_recusado com o motivo', async () => {
    const probe = probeOf({ kind: 'rejected', message: 'thinking.type.disabled is not supported' })
    expect(await validateAiTaskUpdate({ model: 'claude-opus-5-5', settings: OFF }, 'x', { catalog, probe })).toEqual({
      ok: false,
      error: 'ajuste_recusado',
      message: 'thinking.type.disabled is not supported',
    })
  })

  it('teste ok ou indisponível ⇒ aceita (queda da API não trava o admin)', async () => {
    for (const result of [{ kind: 'ok' }, { kind: 'unavailable' }] as ProbeResult[]) {
      const probe = probeOf(result)
      expect(await validateAiTaskUpdate({ model: 'claude-opus-5-5', settings: ON }, 'x', { catalog, probe })).toEqual({
        ok: true,
        model: 'claude-opus-5-5',
        settings: ON,
      })
      expect(probe.calls).toBe(1)
    }
  })
})
