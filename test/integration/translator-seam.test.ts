import { describe, expect, it } from 'vitest'
import { getTranslator, setTranslator, resetDeps } from '@/server/deps'
import {
  RealTranslator,
  FakeTranslator,
  ThrowingTranslator,
  type Translator,
  type TranslateInput,
} from '@/server/translation/translator'

/**
 * Seam de tradução (issue #23, C1) — DI + reset. Espelha a forma do seam de embedding:
 * Real lança (tradução real é PR à parte), Fake devolve canned/identidade, Throwing
 * lança (degradação). `resetDeps()` (chamado no beforeEach global de setup.ts) DEVE
 * zerar o override — senão um translator injetado vazaria entre testes.
 */

const sampleInput: TranslateInput = {
  sourceLocale: 'pt-BR',
  targetLocale: 'en-US',
  fields: { titulo: 'Feijoada', descricao: 'Ensopado.', passos: ['Passo 1'], notas: null },
}

describe('seam Translator #23 — DI + resetDeps', () => {
  it('getTranslator devolve o override após setTranslator', () => {
    const fake = new FakeTranslator()
    setTranslator(fake)
    expect(getTranslator()).toBe(fake)
  })

  it('resetDeps zera o override → getTranslator volta a RealTranslator', () => {
    setTranslator(new FakeTranslator())
    resetDeps()
    expect(getTranslator()).toBeInstanceOf(RealTranslator)
  })

  it('RealTranslator.translate LANÇA (tradução real é PR à parte)', async () => {
    // Real/Throwing ignoram o input (lançam antes) ⇒ assinatura concreta sem param
    // (espelha RealEmbedder.embed()). Exercitados via a interface (translate aceita input).
    const real: Translator = new RealTranslator()
    await expect(real.translate(sampleInput)).rejects.toThrow(/não implementado/)
  })

  it('ThrowingTranslator.translate LANÇA (dublê de degradação)', async () => {
    const throwing: Translator = new ThrowingTranslator()
    await expect(throwing.translate(sampleInput)).rejects.toThrow(/indisponível/)
  })

  it('FakeTranslator sem canned ecoa os campos de origem', async () => {
    const out = await new FakeTranslator().translate(sampleInput)
    expect(out).toEqual(sampleInput.fields)
  })

  it('FakeTranslator com canned devolve o canned (ignora a lógica real)', async () => {
    const canned = { titulo: 'Black Bean Stew', descricao: 'Stew.', passos: ['Step 1'], notas: null }
    const out = await new FakeTranslator(canned).translate(sampleInput)
    expect(out).toEqual(canned)
  })
})
