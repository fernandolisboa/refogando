import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import Link, { localizeLinkHref } from '@/components/locale-link'
import { LocaleProvider } from '@/i18n/provider'

/**
 * `Link` do app (ADR-0061): o href interno nu sai prefixado com o locale da página no HTML, para o Google (e quem
 * está em /en-US sem cookie) não passar pelo 302 do proxy, que escolhe o idioma pelo cookie/Accept-Language.
 */
afterEach(cleanup)

describe('Link (locale-link)', () => {
  it('dentro do LocaleProvider, prefixa o href nu com o locale da página', () => {
    render(
      <LocaleProvider initialLocale="en-US">
        <Link href="/u/ana">perfil</Link>
        <Link href="/pt-BR/recipes/bolo">receita</Link>
        <Link href="https://ex.com">fora</Link>
      </LocaleProvider>,
    )
    expect(screen.getByRole('link', { name: 'perfil' })).toHaveAttribute('href', '/en-US/u/ana')
    expect(screen.getByRole('link', { name: 'receita' })).toHaveAttribute('href', '/pt-BR/recipes/bolo')
    expect(screen.getByRole('link', { name: 'fora' })).toHaveAttribute('href', 'https://ex.com')
  })

  it('fora do provider (seam de teste) o href passa intacto, sem lançar', () => {
    render(<Link href="/cooks">cozinheiros</Link>)
    expect(screen.getByRole('link', { name: 'cozinheiros' })).toHaveAttribute('href', '/cooks')
  })

  it('UrlObject: prefixa só o pathname e preserva o resto', () => {
    expect(localizeLinkHref('pt-BR', { pathname: '/create', query: { q: 'bolo' } })).toEqual({
      pathname: '/pt-BR/create',
      query: { q: 'bolo' },
    })
    expect(localizeLinkHref('pt-BR', { hash: 'x' })).toEqual({ hash: 'x' })
  })
})
