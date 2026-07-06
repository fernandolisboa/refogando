import { describe, it, expect } from 'vitest'
import {
  validateShoppingListName,
  SHOPPING_LIST_NAME_MAX,
  MAX_SHOPPING_LISTS_PER_USER,
  DEFAULT_SHOPPING_LIST_NAME,
} from '@/domain/shopping-list'

/**
 * Kernel PURO da Lista de compras — container (#525, ADR-0032 dec.1): valida o NOME. Sem DB, sem
 * I/O — testável exaustivamente. Regra idêntica a `validateCollectionName`: `name = raw.trim()`;
 * vazio ⇒ 'empty'; comprimento POR CODE POINT > 60 ⇒ 'too_long'; senão `{ ok, name }` (já trimado).
 */
describe('validateShoppingListName', () => {
  it('trima e aceita um nome comum', () => {
    expect(validateShoppingListName('  Churrasco  ')).toEqual({ ok: true, name: 'Churrasco' })
  })

  it('vazio ⇒ empty', () => {
    expect(validateShoppingListName('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('só espaços ⇒ empty (trim zera)', () => {
    expect(validateShoppingListName('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(validateShoppingListName('\t\n ')).toEqual({ ok: false, reason: 'empty' })
  })

  it('exatamente no limite (60) ⇒ ok', () => {
    const at = 'a'.repeat(SHOPPING_LIST_NAME_MAX)
    expect(validateShoppingListName(at)).toEqual({ ok: true, name: at })
  })

  it('acima do limite (61) ⇒ too_long', () => {
    const over = 'a'.repeat(SHOPPING_LIST_NAME_MAX + 1)
    expect(validateShoppingListName(over)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('mede por CODE POINT, não por unidade UTF-16 (emoji não estoura na metade)', () => {
    const emojis = '😀'.repeat(SHOPPING_LIST_NAME_MAX)
    expect(validateShoppingListName(emojis)).toEqual({ ok: true, name: emojis })
    const emojisOver = '😀'.repeat(SHOPPING_LIST_NAME_MAX + 1)
    expect(validateShoppingListName(emojisOver)).toEqual({ ok: false, reason: 'too_long' })
  })

  it('trima ANTES de medir (whitespace de borda não conta pro cap)', () => {
    const padded = `  ${'a'.repeat(SHOPPING_LIST_NAME_MAX)}  `
    expect(validateShoppingListName(padded)).toEqual({
      ok: true,
      name: 'a'.repeat(SHOPPING_LIST_NAME_MAX),
    })
  })

  it('expõe as constantes do domínio', () => {
    expect(SHOPPING_LIST_NAME_MAX).toBe(60)
    expect(MAX_SHOPPING_LISTS_PER_USER).toBe(100)
    expect(DEFAULT_SHOPPING_LIST_NAME).toBe('Lista de compras')
  })
})
