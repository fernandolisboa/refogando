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
