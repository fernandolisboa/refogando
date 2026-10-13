/**
 * Setup do projeto "ui" (jsdom). Estende o expect do Vitest com os matchers do jest-dom
 * (toBeInTheDocument, etc.). Cleanup do Testing Library é automático: com `globals: true`
 * neste projeto, o @testing-library/react registra o afterEach de limpeza sozinho.
 * NÃO carrega o setup de banco do projeto node (sem DI/Postgres aqui).
 */
import { beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'

/**
 * Polyfills de jsdom para as primitivas do Radix (shadcn/ui — ADR-0018). O jsdom não
 * implementa `ResizeObserver` (usado pelo `react-use-size` do Radix em Checkbox/Select)
 * nem as APIs de PointerCapture/`scrollIntoView` que o Select usa ao abrir. Sem esses
 * stubs, só RENDERIZAR uma primitiva Radix lança e derruba o teste.
 *
 * Atribuição DIRETA no globalThis (não `vi.stubGlobal`): vários testes chamam
 * `vi.unstubAllGlobals()` no afterEach (pra limpar o mock de `fetch`), o que removeria um
 * stubGlobal — setando direto, fica fora do rastreio do vi e sobrevive ao unstub.
 */
const g = globalThis as typeof globalThis & { ResizeObserver?: unknown }
g.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const elementProto = Element.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
elementProto.scrollIntoView ??= () => {}
elementProto.hasPointerCapture ??= () => false
elementProto.setPointerCapture ??= () => {}
elementProto.releasePointerCapture ??= () => {}

/**
 * URL limpa a cada teste. O jsdom mantém a `location` entre os testes de um arquivo, e a Busca reflete o
 * estado na URL com `window.history.replaceState` real (#236) — sem este reset, o `?q=` de um teste vazaria
 * para o seguinte (que semearia o termo na montagem). Roda ANTES dos `beforeEach` do arquivo (setup é
 * registrado primeiro), então um teste que monta numa URL própria continua podendo fazê-lo.
 */
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})
