import { vi } from 'vitest'

/**
 * Helper de teste (#372): jsdom não implementa `window.location.reload` de forma mockável via
 * `vi.spyOn` (a propriedade é não-configurável no proto). Substituímos o objeto `location` por um
 * clone com um `reload` espião via `Object.defineProperty` (que jsdom PERMITE em `window`).
 * Chame `restore()` no afterEach pra não vazar entre testes no jsdom compartilhado.
 */
export function stubReload() {
  const reload = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, reload },
  })
  const restore = () =>
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  return { reload, restore }
}

/**
 * Mesma troca do `stubReload`, para `window.location.assign` (#595: a saída depois de excluir a conta
 * recarrega a home do idioma). Traz o `reload` espião junto (a saída por sessão morta recarrega a página).
 */
export function stubAssign() {
  const assign = vi.fn()
  const reload = vi.fn()
  const original = window.location
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...original, assign, reload },
  })
  const restore = () =>
    Object.defineProperty(window, 'location', { configurable: true, value: original })
  return { assign, reload, restore }
}
