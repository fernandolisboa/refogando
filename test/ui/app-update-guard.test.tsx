import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { AppUpdateGuard } from '@/components/app-update-guard'
import { stubReload } from './reload-stub'

/**
 * Guard de atualização graceful (#372, ADR-0028 dec 5-A2) — rede de segurança pra chunk errors
 * que escapam do React (event-handler `import()` que rejeita sem captura). Sem DOM (null);
 * instala listeners globais de `error`/`unhandledrejection` que fazem UM reload quieto.
 */
describe('AppUpdateGuard — rede de segurança graceful (#372)', () => {
  let reloadSpy: ReturnType<typeof stubReload>['reload']
  let restoreReload: () => void

  beforeEach(() => {
    window.sessionStorage.clear()
    const s = stubReload()
    reloadSpy = s.reload
    restoreReload = s.restore
  })
  afterEach(() => {
    restoreReload()
    vi.restoreAllMocks()
  })

  it('mount normal não recarrega e não injeta DOM', () => {
    const { container } = render(<AppUpdateGuard />)
    expect(container).toBeEmptyDOMElement()
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('ChunkLoadError (window error) recarrega uma vez e é loop-safe', () => {
    render(<AppUpdateGuard />)
    const err = new Error('Loading chunk 42 failed')
    err.name = 'ChunkLoadError'
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem('app-update-reload')).toBeTruthy()
    // Dispara de novo dentro da janela → segue em 1 (loop guard).
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('erro não-chunk é ignorado', () => {
    render(<AppUpdateGuard />)
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('boom'), message: 'boom' }))
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('unhandledrejection com ChunkLoadError recarrega', () => {
    render(<AppUpdateGuard />)
    // jsdom não tem PromiseRejectionEvent → sintetiza o evento com `reason`.
    const reason = Object.assign(new Error('x'), { name: 'ChunkLoadError' })
    const ev = Object.assign(new Event('unhandledrejection'), { reason })
    window.dispatchEvent(ev)
    expect(reloadSpy).toHaveBeenCalledTimes(1)
  })

  it('remove os listeners no unmount (não recarrega após desmontar)', () => {
    const { unmount } = render(<AppUpdateGuard />)
    unmount()
    // Sem nosso listener, jsdom re-lançaria o ErrorEvent como "uncaught"; um preventDefault
    // temporário engole isso (não testa o guard — só evita o ruído do harness).
    const swallow = (e: Event) => e.preventDefault()
    window.addEventListener('error', swallow)
    try {
      const err = Object.assign(new Error('Loading chunk 1 failed'), { name: 'ChunkLoadError' })
      window.dispatchEvent(new ErrorEvent('error', { error: err, message: err.message }))
      expect(reloadSpy).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('error', swallow)
    }
  })
})
