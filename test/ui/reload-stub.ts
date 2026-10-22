import { vi } from 'vitest'

/**
 * Helper de teste (#372): jsdom não implementa `window.location.reload`/`assign` de forma mockável via
 * `vi.spyOn` (as propriedades são não-configuráveis no proto). Substituímos o objeto `location` por um
 * clone com `assign` e `reload` espiões via `Object.defineProperty` (que jsdom PERMITE em `window`).
 * Chame `restore()` no afterEach pra não vazar entre testes no jsdom compartilhado.
 */
export function stubLocation() {
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

/** Só o `reload` espião (o caso de quem recarrega a página: erro, app desatualizado). */
export function stubReload() {
  const { reload, restore } = stubLocation()
  return { reload, restore }
}
