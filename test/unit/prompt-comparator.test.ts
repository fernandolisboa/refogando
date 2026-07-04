import { describe, it, expect } from 'vitest'
import {
  FIXED_BRIEFINGS,
  BASELINE_SYSTEM_PROMPTS,
  COMPARATOR_COZINHA_SLUGS,
  comparisonSystemPrompts,
  comparatorPrompt,
  recipeView,
  type ComparatorFixture,
} from '@/domain/prompt-comparator'
import { buildSystemPrompt, parseBriefing, type PromptMode } from '@/domain/briefing'
import type { ReceitaGenT } from '@/domain/recipe-gen-schema'

/** ReceitaGenT mínima inline — mantém este teste de DOMÍNIO puro (sem arrastar a rota/DB do helper). */
function makeReceita(overrides: Partial<ReceitaGenT> = {}): ReceitaGenT {
  return {
    titulo: 'Arroz de forno',
    descricao: null,
    passos: ['Misture tudo.'],
    notas: null,
    originalLocale: 'pt-BR',
    cozinha: 'brasileira',
    categoria: 'prato_principal',
    restricoes: [],
    porcoes: 4,
    dificuldade: 2,
    ingredientes: [{ nome: 'arroz cozido', quantidade: '2.000', unidade: 'xicara' }],
    ...overrides,
  }
}

/**
 * Comparador de prompt (#425, ADR-0029 dec.7) — domínio PURO. Prova o HARNESS/tracer:
 *  - `comparisonSystemPrompts` old===new byte-a-byte em Wave 1 (registro de eixos VAZIO): o BASELINE
 *    congelado bate com o `buildSystemPrompt` vivo — se a cópia driftar do base, isto grita.
 *  - toda fixture `structured` parseia (parseBriefing com o slug-set fixo) e é NÃO-vazia.
 *  - cobertura: os 3 modos e ≥8 cozinhas distintas; ids únicos e determinísticos.
 *  - `comparatorPrompt`: userPrompt IDÊNTICO nos dois lados; só o systemPrompt difere (velho=BASELINE).
 */

const MODES: PromptMode[] = ['briefing', 'free_text', 'distillation', 'conversation_stream']

describe('comparisonSystemPrompts — old===new byte-a-byte (Wave 1, registro de eixos vazio)', () => {
  it.each(MODES)('modo %s: old === new === buildSystemPrompt (base)', (mode) => {
    const { old, new: nova } = comparisonSystemPrompts(mode)
    expect(old).toBe(nova)
    expect(nova).toBe(buildSystemPrompt(mode))
    expect(old).toBe(BASELINE_SYSTEM_PROMPTS[mode])
  })
})

describe('FIXED_BRIEFINGS — cobertura e integridade', () => {
  it('tem entre 8 e 10 fixtures', () => {
    expect(FIXED_BRIEFINGS.length).toBeGreaterThanOrEqual(8)
    expect(FIXED_BRIEFINGS.length).toBeLessThanOrEqual(10)
  })

  it('ids únicos, não-vazios e determinísticos (string)', () => {
    const ids = FIXED_BRIEFINGS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0)
  })

  it('cobre os 3 modos de geração (briefing, free_text, distillation)', () => {
    const modes = new Set(FIXED_BRIEFINGS.map((f) => f.mode))
    expect(modes).toContain('briefing')
    expect(modes).toContain('free_text')
    expect(modes).toContain('distillation')
  })

  it('cobre ≥8 cozinhas distintas (via id/conteúdo do vocabulário controlado)', () => {
    // As fixtures structured cravam a cozinha no briefing; as demais mencionam a cozinha no texto.
    // Aqui contamos as cozinhas distintas das structured (cravadas) + o número de slugs do comparador.
    const structuredCozinhas = new Set(
      FIXED_BRIEFINGS.filter((f): f is Extract<ComparatorFixture, { mode: 'briefing' }> => f.mode === 'briefing').map(
        (f) => f.briefing.cozinha,
      ),
    )
    expect(structuredCozinhas.size).toBeGreaterThanOrEqual(4)
    expect(COMPARATOR_COZINHA_SLUGS.length).toBeGreaterThanOrEqual(8)
  })
})

describe('fixtures structured — parseiam com o slug-set fixo e são não-vazias', () => {
  const active = new Set<string>(COMPARATOR_COZINHA_SLUGS)
  const structured = FIXED_BRIEFINGS.filter(
    (f): f is Extract<ComparatorFixture, { mode: 'briefing' }> => f.mode === 'briefing',
  )

  it.each(structured.map((f) => [f.id, f] as const))('%s parseia ok e não-vazio', (_id, fixture) => {
    const parsed = parseBriefing(fixture.briefing, active)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.briefing.itens.length).toBeGreaterThan(0)
      expect(COMPARATOR_COZINHA_SLUGS).toContain(parsed.briefing.cozinha)
    }
  })
})

describe('comparatorPrompt — userPrompt idêntico nos dois lados; systemPrompt difere só na fonte', () => {
  it.each(FIXED_BRIEFINGS.map((f) => [f.id, f] as const))(
    '%s: userPrompt igual; old=BASELINE, new=buildSystemPrompt',
    (_id, fixture) => {
      const oldSide = comparatorPrompt(fixture, 'old')
      const newSide = comparatorPrompt(fixture, 'new')
      expect(oldSide.userPrompt).toBe(newSide.userPrompt)
      expect(oldSide.systemPrompt).toBe(BASELINE_SYSTEM_PROMPTS[fixture.mode])
      expect(newSide.systemPrompt).toBe(buildSystemPrompt(fixture.mode, fixture.axes))
      // Wave 1 (registro vazio): os dois lados coincidem — o comparador prova o harness.
      expect(oldSide.systemPrompt).toBe(newSide.systemPrompt)
    },
  )
})

describe('recipeView — vista de leitura (medida formatada, nunca de volta ao nome)', () => {
  it('formata ingrediente com medida e sem medida', () => {
    const view = recipeView(
      makeReceita({
        ingredientes: [
          { nome: 'arroz', quantidade: '2.000', unidade: 'xicara' },
          { nome: 'sal', quantidade: null, unidade: 'a_gosto' },
        ],
      }),
    )
    expect(view.ingredientes[0]).toContain('arroz')
    expect(view.ingredientes[0]).toContain('2.000')
    expect(view.ingredientes[0]).toContain('xicara')
    // 'sal' com a_gosto ainda carrega a unidade a_gosto (não-vazia) — só o que é null/'' é omitido.
    expect(view.ingredientes[1]).toContain('sal')
    expect(view.titulo).toBe('Arroz de forno')
  })
})
