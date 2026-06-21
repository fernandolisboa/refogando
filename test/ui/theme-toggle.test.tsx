import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

import { LocaleProvider } from '@/i18n/provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { resolveThemeClass } from '@/lib/theme'
import { ptBR } from '@/i18n/messages/pt-BR'

/**
 * Seam de FRONTEND (issue #54, ADR-0018) — prova, sem browser/Postgres, o toggle de tema:
 * render conforme `initialTheme`, e o clique alternando a classe do <html> + gravando o
 * cookie `theme`. O label vem de `messages.theme.*` (a11y), via o mesmo provider de locale
 * que a chrome usa. Inclui um unit puro de `resolveThemeClass` (sem React/Postgres aqui).
 */

function renderToggle(initialTheme: 'light' | 'dark' | null) {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ThemeToggle initialTheme={initialTheme} />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  // Estado limpo entre os testes: sem classe forçada e sem cookie de tema.
  document.documentElement.classList.remove('dark', 'light')
  document.cookie = 'theme=; path=/; max-age=0'
  // matchMedia não existe no jsdom por padrão; quando `initialTheme` é null o componente o
  // consulta. Stub para "SO claro" (não-dark) — estável e previsível.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
})

describe('ThemeToggle (ADR-0018)', () => {
  it('com initialTheme="light" mostra o afford. de ir pro escuro e alterna no clique', async () => {
    const user = userEvent.setup()
    renderToggle('light')

    // Tema claro → ação = ir pro escuro: rótulo "Mudar para o tema escuro".
    const btn = screen.getByRole('button', { name: ptBR.theme.dark })
    expect(btn).toBeInTheDocument()

    await user.click(btn)

    // Clique: <html> ganha .dark, perde .light; cookie persistido; o rótulo inverte.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(document.cookie).toContain('theme=dark')
    expect(screen.getByRole('button', { name: ptBR.theme.light })).toBeInTheDocument()
  })

  it('com initialTheme="dark" mostra o afford. de ir pro claro e alterna no clique', async () => {
    const user = userEvent.setup()
    renderToggle('dark')

    const btn = screen.getByRole('button', { name: ptBR.theme.light })
    expect(btn).toBeInTheDocument()

    await user.click(btn)

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.cookie).toContain('theme=light')
    expect(screen.getByRole('button', { name: ptBR.theme.dark })).toBeInTheDocument()
  })

  it('com initialTheme=null (segue o SO) reconcilia via matchMedia e ainda alterna', async () => {
    const user = userEvent.setup()
    renderToggle(null)

    // SO claro (matchMedia stub matches:false) → afford. de ir pro escuro.
    const btn = await screen.findByRole('button', { name: ptBR.theme.dark })
    await user.click(btn)
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.cookie).toContain('theme=dark')
  })
})

describe('resolveThemeClass (puro)', () => {
  it('mapeia o cookie cru para a classe do <html>', () => {
    expect(resolveThemeClass('dark')).toBe('dark')
    expect(resolveThemeClass('light')).toBe('light')
    expect(resolveThemeClass(undefined)).toBe('')
    expect(resolveThemeClass(null)).toBe('')
    expect(resolveThemeClass('')).toBe('')
    expect(resolveThemeClass('bogus')).toBe('')
  })
})
