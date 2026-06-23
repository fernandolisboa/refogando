import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do LocaleSwitcher sob locale-no-caminho (#228/ADR-0020). O ponto load-bearing: a
 * troca de idioma NAVEGA pra URL irmã (`/{novoLocale}{resto}`) — não basta setar o cookie e mutar
 * `<html lang>`. Sem navegar, `<html lang>`/chrome ficariam em EN mas o path e o corpo do servidor
 * em PT (lang ≠ conteúdo — defeito de a11y/SEO). Mockamos `next/navigation` (router + pathname).
 */

const push = vi.fn()
let pathname = '/pt-BR'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}))

import { LocaleSwitcher } from '@/i18n/locale-switcher'
import { LocaleProvider } from '@/i18n/provider'
import type { Locale } from '@/i18n/locale'

/** Renderiza o switcher dentro do LocaleProvider REAL (o `setLocale` de verdade grava cookie +
 *  sincroniza `<html lang>`) — exercita o efeito completo da troca, não um mock de `useLocale`. */
function renderSwitcher(initial: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={initial}>
      <LocaleSwitcher />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  push.mockClear()
  pathname = '/pt-BR'
  document.documentElement.lang = 'pt-BR'
  // Cookie limpo entre casos (jsdom acumula).
  document.cookie = 'locale=; Max-Age=0; Path=/'
})

afterEach(() => {
  cleanup()
})

describe('LocaleSwitcher (#228)', () => {
  it('trocar pt-BR → en-US NAVEGA pra URL irmã preservando o resto do path', async () => {
    pathname = '/pt-BR/recipes/bolo-de-cenoura'
    renderSwitcher()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'en-US')

    // Navega trocando SÓ o prefixo de locale (o resto do path é preservado) — lang, URL e corpo
    // (re-renderizado pelo servidor no novo locale) voltam a concordar.
    expect(push).toHaveBeenCalledWith('/en-US/recipes/bolo-de-cenoura')
  })

  it('na raiz prefixada (/pt-BR) navega pra raiz irmã (/en-US), sem barra pendurada', async () => {
    pathname = '/pt-BR'
    renderSwitcher()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'en-US')

    expect(push).toHaveBeenCalledWith('/en-US')
  })

  it('persiste o cookie de locale na troca (decide o redirect da raiz no proxy)', async () => {
    pathname = '/pt-BR/recipes'
    renderSwitcher()

    await userEvent.selectOptions(screen.getByRole('combobox'), 'en-US')

    // `setLocale` → `applyLocaleSideEffects` grava o cookie `locale=en-US` (NÃO-HttpOnly).
    expect(document.cookie).toContain('locale=en-US')
    // E não deixa `<html lang>` preso no SSR: a navegação re-renderiza o documento, mas o efeito
    // imediato já sincroniza o atributo com o novo idioma (sem janela de lang ≠ conteúdo).
    expect(document.documentElement.lang).toBe('en-US')
  })

  it('selecionar o MESMO locale não navega (no-op, sem push espúrio)', async () => {
    pathname = '/pt-BR/recipes'
    renderSwitcher()

    // Re-selecionar o valor já corrente não dispara navegação.
    await userEvent.selectOptions(screen.getByRole('combobox'), 'pt-BR')
    expect(push).not.toHaveBeenCalled()
  })
})
