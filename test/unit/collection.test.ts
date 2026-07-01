import { describe, it, expect } from 'vitest'
import {
  validateCollectionName,
  COLLECTION_NAME_MAX,
  MAX_COLLECTIONS_PER_USER,
} from '@/domain/collection'

/**
 * Kernel PURO da Coleção (#364): valida o NOME. Sem DB, sem I/O — testável exaustivamente.
 * Regra: `name = raw.trim()`; vazio ⇒ 'empty'; comprimento POR CODE POINT > 60 ⇒ 'too_long';
 * senão `{ ok, name }` (já trimado). Espelha a disciplina de trim+cap de `/api/me` (nome/bio).
 */
describe('validateCollectionName', () => {
  it('trima e aceita um nome comum', () => {
    expect(validateCollectionName('  Massas  ')).toEqual({ ok: true, name: 'Massas' })
  })

  it('vazio ⇒ empty', () => {
    expect(validateCollectionName('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('só espaços ⇒ empty (trim zera)', () => {
    expect(validateCollectionName('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateCollectionName('\t\n ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('exatamente no limite (60) ⇒ ok', () => {
    const at = 'a'.repeat(COLLECTION_NAME_MAX)
    expect(validateCollectionName(at)).toEqual({ ok: true, name: at })
  })

  it('acima do limite (61) ⇒ too_long', () => {
    const over = 'a'.repeat(COLLECTION_NAME_MAX + 1)
    expect(validateCollectionName(over)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('mede por CODE POINT, não por unidade UTF-16 (emoji não estoura na metade)', () => {
    // 60 emojis (cada um = 2 unidades UTF-16). `.length` diria 120; Array.from conta 60 ⇒ ok.
    const emojis = '😀'.repeat(COLLECTION_NAME_MAX)
    expect(validateCollectionName(emojis)).toEqual({ ok: true, name: emojis })
    const emojisOver = '😀'.repeat(COLLECTION_NAME_MAX + 1)
    expect(validateCollectionName(emojisOver)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('trima ANTES de medir (whitespace de borda não conta pro cap)', () => {
    const padded = `  ${'a'.repeat(COLLECTION_NAME_MAX)}  `
    expect(validateCollectionName(padded)).toEqual({
      ok: true,
      name: 'a'.repeat(COLLECTION_NAME_MAX),
    })
  })

  it('expõe as constantes do domínio', () => {
    expect(COLLECTION_NAME_MAX).toBe(60)
    expect(MAX_COLLECTIONS_PER_USER).toBe(100)
  })
})
