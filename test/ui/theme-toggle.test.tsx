import { describe, it, expect, beforeEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { RequestCookies } from 'next/dist/server/web/spec-extension/cookies'

import { LocaleProvider } from '@/i18n/provider'
import { ThemeToggle } from '@/components/theme-toggle'
import { DEFAULT_THEME_CLASS, THEMES, THEME_COOKIE, resolveThemeClass } from '@/lib/theme'
import { THEME_INIT_SCRIPT, applyThemeFromCookie } from '@/lib/theme-script'
import { ptBR } from '@/i18n/messages/pt-BR'

/**
 * Seam de FRONTEND (issue #54, ADR-0018) — prova, sem browser/Postgres, o tema claro/escuro depois do
 * achado A da auditoria de performance (handoff 67): o layout não lê mais o cookie; o servidor emite
 * `DEFAULT_THEME_CLASS` e o script pré-pintura (`THEME_INIT_SCRIPT`) aplica a classe do cookie.
 *
 *  - Script: paridade com o caminho antigo do servidor (`resolveThemeClass` sobre o
 *    `cookies().get('theme')` do Next, aqui o mesmo `RequestCookies`) para cookies presentes, ausentes,
 *    inválidos e esquisitos; e o TEXTO do script, executado, deixa no `<html>` a mesma classe.
 *  - Toggle: lê o tema da classe do `<html>`, grava o cookie e alterna a classe no clique; ícone por CSS.
 */

function renderToggle() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <ThemeToggle />
    </LocaleProvider>,
  )
}

/** Classe que o layout ANTIGO emitia para este header `Cookie` (o que o `cookies()` do Next devolvia). */
function serverClassFor(cookieHeader: string): 'dark' | 'light' {
  return resolveThemeClass(new RequestCookies(new Headers({ cookie: cookieHeader })).get(THEME_COOKIE)?.value)
}

/** Um `<html>` de mentira com a classe que o servidor emite, e o cookie cru. */
function fakeDoc(cookie: string) {
  const html = document.createElement('html')
  html.className = DEFAULT_THEME_CLASS
  return { cookie, documentElement: html }
}

// Casos gerados de CADA valor de `Theme` (um tema novo ganha paridade sem editar esta lista): sozinho,
// entre outros cookies, com e sem espaço, em maiúsculas, com nome parecido, codificado e o último par
// vencendo em toda combinação de dois temas.
const PER_THEME = THEMES.flatMap((t) => [
  `theme=${t}`,
  `locale=en-US; theme=${t}`,
  `theme=${t}; locale=en-US`,
  `theme=${t};locale=en-US`,
  `theme=${t.toUpperCase()}`,
  `xtheme=${t}`,
  `theme=%${t.charCodeAt(0).toString(16)}${t.slice(1)}`,
  ...THEMES.map((u) => `theme=${t}; theme=${u}`),
])

// Sem espaço no começo: o `Headers` (e o HTTP) apara o valor do header, e o `document.cookie` nunca começa
// com espaço, então esse caso não existe nos dois lados ao mesmo tempo.
const EDGE_COOKIES = [
  '',
  'theme=dark',
  'theme=light',
  'theme=',
  'theme=DARK',
  'theme=bogus',
  'theme',
  'locale=pt-BR',
  'locale=en-US; theme=dark',
  'theme=dark; locale=en-US',
  'theme=dark;locale=en-US',
  'theme=dark;  other=1',
  'other=1;  theme=dark',
  'xtheme=dark',
  'theme2=dark',
  'theme=light; theme=dark',
  'theme=dark; theme=light',
  'theme=%64ark',
  'theme=dark%',
  'theme=dark; theme=%E0%A4%A',
  'theme=dark=1',
  'a=b; ; theme=dark',
]
const COOKIES = [...new Set([...EDGE_COOKIES, ...PER_THEME])]

beforeEach(() => {
  // Estado limpo entre os testes: o `<html>` como o servidor emite e sem cookie de tema.
  document.documentElement.className = DEFAULT_THEME_CLASS
  document.cookie = `${THEME_COOKIE}=; path=/; max-age=0`
})

describe('script pré-pintura do tema (THEME_INIT_SCRIPT)', () => {
  it('o servidor emite a classe de quem não tem cookie (claro, issue #208)', () => {
    expect(DEFAULT_THEME_CLASS).toBe('light')
    expect(DEFAULT_THEME_CLASS).toBe(serverClassFor(''))
  })

  it.each(COOKIES)('cookie %j: mesma classe que o servidor emitia ao ler o cookie', (cookie) => {
    const doc = fakeDoc(cookie)
    applyThemeFromCookie(doc, THEME_COOKIE)
    expect(doc.documentElement.className).toBe(serverClassFor(cookie))
  })

  it.each(COOKIES)('cookie %j: o TEXTO do script, executado, aplica a mesma classe', (cookie) => {
    const doc = fakeDoc(cookie)
    new Function('document', THEME_INIT_SCRIPT)(doc)
    expect(doc.documentElement.className).toBe(serverClassFor(cookie))
  })

  it('casos explícitos: escuro só com theme=dark; ausente/inválido fica claro', () => {
    const run = (cookie: string) => {
      const doc = fakeDoc(cookie)
      new Function('document', THEME_INIT_SCRIPT)(doc)
      return doc.documentElement.className
    }
    expect(run('theme=dark')).toBe('dark')
    expect(run('locale=pt-BR; theme=dark')).toBe('dark')
    expect(run('theme=light')).toBe('light')
    expect(run('')).toBe('light')
    expect(run('theme=bogus')).toBe('light')
  })

  it('não mexe em outras classes do <html> e troca light por dark sem deixar as duas', () => {
    const doc = fakeDoc('theme=dark')
    doc.documentElement.classList.add('outra')
    applyThemeFromCookie(doc, THEME_COOKIE)
    expect([...doc.documentElement.classList].sort()).toEqual(['dark', 'outra'])
  })

  it('erro ao ler o cookie deixa a classe do servidor (claro)', () => {
    const html = document.createElement('html')
    html.className = DEFAULT_THEME_CLASS
    const doc = {
      get cookie(): string {
        throw new Error('cookies bloqueados')
      },
      documentElement: html,
    }
    expect(() => new Function('document', THEME_INIT_SCRIPT)(doc)).not.toThrow()
    expect(html.className).toBe('light')
  })

  it('é autossuficiente: roda sem nada do módulo em escopo (só `document`)', () => {
    // `new Function` só enxerga o escopo global; se o script referenciasse algo importado, lançaria
    // ReferenceError dentro do try e o <html> ficaria claro mesmo com theme=dark.
    const doc = fakeDoc('theme=dark')
    new Function('document', THEME_INIT_SCRIPT)(doc)
    expect(doc.documentElement.className).toBe('dark')
  })

  it('com o document real do jsdom: lê document.cookie e troca a classe do <html>', () => {
    document.cookie = `${THEME_COOKIE}=dark; path=/`
    new Function(THEME_INIT_SCRIPT)()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
  })
})

describe('ThemeToggle (ADR-0018)', () => {
  it('<html class="light"> mostra o afford. de ir pro escuro e alterna no clique', async () => {
    const user = userEvent.setup()
    renderToggle()

    // Tema claro → ação = ir pro escuro: rótulo "Mudar para o tema escuro".
    const btn = screen.getByRole('button', { name: ptBR.theme.dark })
    await user.click(btn)

    // Clique: <html> ganha .dark, perde .light; cookie persistido; o rótulo inverte.
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(document.documentElement.classList.contains('light')).toBe(false)
    expect(document.cookie).toContain('theme=dark')
    expect(await screen.findByRole('button', { name: ptBR.theme.light })).toBeInTheDocument()
  })

  it('<html class="dark"> (aplicado pelo script) mostra o afford. de ir pro claro e alterna no clique', async () => {
    const user = userEvent.setup()
    document.documentElement.className = 'dark'
    renderToggle()

    const btn = screen.getByRole('button', { name: ptBR.theme.light })
    await user.click(btn)

    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(document.cookie).toContain('theme=light')
    expect(await screen.findByRole('button', { name: ptBR.theme.dark })).toBeInTheDocument()
  })

  it('o cookie gravado é o mesmo de antes (1 ano, Path=/, SameSite=Lax) e o script o lê de volta', async () => {
    const user = userEvent.setup()
    const writes: string[] = []
    const desc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => desc.get!.call(document),
      set: (v: string) => {
        writes.push(v)
        desc.set!.call(document, v)
      },
    })
    try {
      renderToggle()
      await user.click(screen.getByRole('button', { name: ptBR.theme.dark }))
    } finally {
      delete (document as { cookie?: string }).cookie
    }
    expect(writes).toEqual(['theme=dark; path=/; max-age=31536000; samesite=lax'])

    // Próxima carga de página: o servidor manda 'light' e o script, lendo o cookie gravado, põe 'dark'.
    document.documentElement.className = DEFAULT_THEME_CLASS
    new Function(THEME_INIT_SCRIPT)()
    expect(document.documentElement.className).toBe('dark')
  })

  it('acompanha uma troca de classe feita fora do toggle (MutationObserver)', async () => {
    renderToggle()
    expect(screen.getByRole('button', { name: ptBR.theme.dark })).toBeInTheDocument()
    await act(async () => {
      document.documentElement.className = 'dark'
    })
    expect(await screen.findByRole('button', { name: ptBR.theme.light })).toBeInTheDocument()
  })

  it('ícone escolhido por CSS (`dark:` = .dark no <html>): certo já na primeira pintura', () => {
    const { container } = renderToggle()
    const moon = container.querySelector('svg.lucide-moon')
    const sun = container.querySelector('svg.lucide-sun')
    // Lua some no escuro; sol só aparece no escuro.
    expect(moon).toHaveClass('dark:hidden')
    expect(sun).toHaveClass('hidden', 'dark:block')
  })
})

describe('resolveThemeClass (puro)', () => {
  it('mapeia o cookie cru para a classe do <html>', () => {
    expect(resolveThemeClass('dark')).toBe('dark')
    expect(resolveThemeClass('light')).toBe('light')
    // Padrão inicial = claro (issue #208): cookie ausente/desconhecido → 'light' (emite
    // `.light` no <html>, derrotando a @media do SO). Antes era '' (deixava o SO decidir).
    expect(resolveThemeClass(undefined)).toBe('light')
    expect(resolveThemeClass(null)).toBe('light')
    expect(resolveThemeClass('')).toBe('light')
    expect(resolveThemeClass('bogus')).toBe('light')
  })
})
