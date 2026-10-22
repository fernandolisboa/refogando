/**
 * `src/app/global-error.tsx` (#590): a boundary do root layout. Fora do `LocaleProvider`, então o texto vem
 * do locale do pathname; relata como `global`; "tentar de novo" chama o retry; chunk velho recarrega e não
 * relata. O pré-render (`renderToString`) usa o `DEFAULT_LOCALE` — nada de `window` no render.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToString } from 'react-dom/server'
import '@testing-library/jest-dom/vitest'
import { GlobalErrorScreen } from '@/components/global-error-screen'
import RootGlobalError from '@/app/global-error'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { reportClientError } from '@/lib/client-error-report'
import { stubReload } from './reload-stub'

vi.mock('@/lib/client-error-report', () => ({ reportClientError: vi.fn(() => true) }))

describe('GlobalErrorScreen', () => {
  beforeEach(() => {
    vi.mocked(reportClientError).mockClear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('texto no locale do pathname (en-US), relata como global e o botão chama o retry', async () => {
    window.history.replaceState(null, '', '/en-US/recipes/bolo')
    const retry = vi.fn()
    const error = new Error('boom')
    render(<GlobalErrorScreen error={error} retry={retry} />)
    expect(screen.getByRole('heading', { name: enUS.system.error })).toBeInTheDocument()
    expect(reportClientError).toHaveBeenCalledTimes(1)
    expect(reportClientError).toHaveBeenCalledWith('global', error)
    await userEvent.setup().click(screen.getByRole('button', { name: enUS.system.retry }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('pathname sem locale ⇒ pt-BR', () => {
    render(<GlobalErrorScreen error={new Error('boom')} retry={vi.fn()} />)
    expect(screen.getByRole('heading', { name: ptBR.system.error })).toBeInTheDocument()
  })

  it('ChunkLoadError ⇒ reload quieto, sem relato', () => {
    const { reload, restore } = stubReload()
    try {
      window.sessionStorage.clear()
      render(<GlobalErrorScreen error={Object.assign(new Error('x'), { name: 'ChunkLoadError' })} retry={vi.fn()} />)
      expect(reload).toHaveBeenCalledTimes(1)
      expect(reportClientError).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

describe('RootGlobalError', () => {
  it('pré-render usa o DEFAULT_LOCALE e traz <html>/<body> próprios', () => {
    window.history.replaceState(null, '', '/en-US')
    const html = renderToString(<RootGlobalError error={new Error('x')} unstable_retry={() => {}} />)
    expect(html).toMatch(/^<html lang="pt-BR"/)
    expect(html).toContain('<body')
    expect(html).toContain(ptBR.system.error)
  })
})
