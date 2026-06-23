import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// next/link precisa do AppRouterContext em runtime; no jsdom não há router montado.
// Mockamos pra um <a> simples — o que importa aqui é a chrome e a NAVEGAÇÃO do switcher.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

// O LocaleSwitcher agora NAVEGA pra URL irmã (#228/ADR-0020), então usa useRouter/usePathname.
// Mockamos: `push` espionável + um pathname prefixado (o shell vive sob `[locale]`).
const navMock = vi.hoisted(() => ({ push: vi.fn(), pathname: '/pt-BR' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navMock.push }),
  usePathname: () => navMock.pathname,
}))

// O AuthSlot agora chama useSession; sem mock o hook tentaria buscar /api/auth/get-session
// (quebraria no jsdom). Mock com o shape COMPLETO de useSession (Visitante: data=null), pra
// as asserções de "Entrar"/"Sign in" do header seguirem válidas e o contrato tipado bater.
// Sessão MUTÁVEL por teste (Visitante por padrão; um teste a torna logada p/ ver "Minhas
// criações"). `vi.hoisted` porque a factory de `vi.mock` é içada acima dos imports.
const authMock = vi.hoisted(() => {
  const anon = { data: null, error: null, isPending: false, isRefetching: false, refetch: () => {} }
  return { anon, current: anon as unknown }
})
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.current,
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { SiteHeader } from '@/components/site-header'
import { SiteFooter } from '@/components/site-footer'

/**
 * Seam de teste de FRONTEND (issue #54) — prova, acima da seam de servidor e sem
 * browser/Postgres, que: (1) a chrome renderiza no locale inicial; (2) trocar o seletor
 * de idioma (no FOOTER, #162) NAVEGA pra URL irmã (#228/ADR-0020 — a URL é a verdade do
 * idioma; a chrome re-renderiza no servidor após a navegação, não in-place no client).
 */
describe('Shell — troca de locale (seletor no footer) NAVEGA pra URL irmã', () => {
  it('renderiza pt-BR e, ao trocar o seletor, navega pra /en-US{resto} (não cascateia in-place)', async () => {
    const user = userEvent.setup()
    navMock.pathname = '/pt-BR/recipes'
    render(
      <LocaleProvider initialLocale="pt-BR">
        <SiteHeader />
        <SiteFooter />
      </LocaleProvider>,
    )

    // Estado inicial: chrome em pt-BR.
    const nav = screen.getByRole('navigation')
    expect(within(nav).getByText('Início')).toBeInTheDocument()
    expect(within(nav).getByText('Receitas')).toBeInTheDocument()
    // Criar PRESENTE na nav; a entrada "Conversar" foi removida (#104 S6 — o Modo Conversa
    // vive dentro de /create agora, não como um slot de nav próprio).
    expect(within(nav).getByText('Criar')).toBeInTheDocument()
    expect(within(nav).queryByText('Conversar')).not.toBeInTheDocument()
    expect(screen.getByText('Entrar')).toBeInTheDocument()
    // #162: o seletor de idioma vive no FOOTER (não no header). Ausente do banner,
    // presente no contentinfo. É o único combobox da chrome.
    const header = screen.getByRole('banner')
    const footer = screen.getByRole('contentinfo')
    expect(within(header).queryByRole('combobox')).toBeNull()
    const select = within(footer).getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('pt-BR')

    // Troca o idioma no seletor.
    await user.selectOptions(select, 'en-US')

    // #228/ADR-0020: NAVEGA pra URL irmã (troca só o prefixo de locale, preserva o resto). A
    // chrome NÃO cascateia in-place no client — ela re-renderiza no servidor após a navegação
    // (fora do alcance do jsdom). O que provamos aqui é a navegação + o cookie persistido.
    expect(navMock.push).toHaveBeenCalledWith('/en-US/recipes')
    expect(document.cookie).toContain('locale=en-US')
    // `<html lang>` é sincronizado de imediato pelo efeito da troca (evita janela lang ≠ conteúdo).
    expect(document.documentElement.lang).toBe('en-US')
  })

  afterEach(() => {
    authMock.current = authMock.anon
    navMock.push.mockClear()
    navMock.pathname = '/pt-BR'
    document.cookie = 'locale=; Max-Age=0; Path=/'
    document.documentElement.lang = 'pt-BR'
  })

  it('logado: "Minhas criações" vem ANTES de "Criar" na nav (Criar é a CTA destacada por último)', () => {
    authMock.current = {
      data: { user: { id: 'u1', name: 'X', email: 'x@y.z', role: 'user', deletedAt: null } },
      error: null,
      isPending: false,
      isRefetching: false,
      refetch: () => {},
    }
    render(
      <LocaleProvider initialLocale="pt-BR">
        <SiteHeader />
      </LocaleProvider>,
    )
    const nav = screen.getByRole('navigation')
    // #191: "Criar" virou um BOTÃO (abre o drawer), então a ordem mistura links + botão. Lê os
    // itens de nav em ORDEM de DOM (links e botões) para asseverar "Minhas criações" antes de
    // "Criar".
    const labels = Array.from(nav.querySelectorAll('a, button')).map((el) => el.textContent)
    const iMinhas = labels.indexOf('Minhas criações')
    const iCriar = labels.indexOf('Criar')
    expect(iMinhas).toBeGreaterThanOrEqual(0)
    expect(iCriar).toBeGreaterThan(iMinhas)
  })

  it('#162: idioma vive no footer (ao lado do ThemeToggle); header mantém só o AuthSlot', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <SiteHeader />
        <SiteFooter />
      </LocaleProvider>,
    )
    const header = screen.getByRole('banner')
    const footer = screen.getByRole('contentinfo')
    // Seletor de idioma: AUSENTE do header, PRESENTE no footer.
    expect(within(header).queryByRole('combobox')).toBeNull()
    expect(within(footer).getByRole('combobox')).toBeInTheDocument()
    // ThemeToggle (botão) segue no footer, junto do idioma.
    expect(within(footer).getByRole('button')).toBeInTheDocument()
    // O AuthSlot do header NÃO regrediu: "Entrar" (Visitante) continua no banner.
    expect(within(header).getByText('Entrar')).toBeInTheDocument()
  })
})
