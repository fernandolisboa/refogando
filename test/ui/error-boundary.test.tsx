import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { LocaleProvider } from '@/i18n/provider'
import GlobalError from '@/app/[locale]/error'
import { ptBR } from '@/i18n/messages/pt-BR'
import { stubReload } from './reload-stub'

/**
 * Error boundary global (#54) + atualização graceful A2 (#372, ADR-0028 dec 5): um chunk de rota
 * velho pós-deploy é jogado em RENDER e cai AQUI (não no window) → reload quieto one-shot. Erro
 * comum mantém a tela calma de "tentar de novo".
 */
function renderErr(error: Error & { digest?: string }, reset = vi.fn()) {
  render(
    <LocaleProvider initialLocale="pt-BR">
      <GlobalError error={error} reset={reset} />
    </LocaleProvider>,
  )
  return reset
}

describe('GlobalError — atualização graceful A2 (#372)', () => {
  let reloadSpy: ReturnType<typeof stubReload>['reload']
  let restoreReload: () => void

  beforeEach(() => {
    window.sessionStorage.clear()
    const s = stubReload()
    reloadSpy = s.reload
    restoreReload = s.restore
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    restoreReload()
    vi.restoreAllMocks()
  })

  it('recarrega em ChunkLoadError de render-phase (sem chamar reset)', () => {
    const error = Object.assign(new Error('Loading chunk 9 failed'), { name: 'ChunkLoadError' })
    const reset = renderErr(error)
    expect(reloadSpy).toHaveBeenCalledTimes(1)
    expect(reset).not.toHaveBeenCalled()
  })

  it('erro comum mantém a tela de "tentar de novo" e o botão chama reset', async () => {
    const user = userEvent.setup()
    const reset = renderErr(new Error('boom'))
    expect(reloadSpy).not.toHaveBeenCalled()
    const btn = screen.getByRole('button', { name: ptBR.system.retry })
    await user.click(btn)
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
