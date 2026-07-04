import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom (sem DB) da página de Política de Privacidade PUBLICADA (#398 / parte de #276). Cobre:
 *  - render bilíngue das DUAS partes (Parte a + Parte b);
 *  - PUBLICAÇÃO: nenhum placeholder/`[validar]` sobra no render (zero `[data-todo]`, zero `{`/`}`),
 *    e o e-mail real do encarregado (privacidade@refogando.com) aparece;
 *  - rodapé de status/versão;
 *  - paridade de comprimento das listas pt-BR/en-US da seção (rede de segurança do teste node de paridade).
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import { PrivacyPolicy } from '@/components/legal/privacy-policy'

function renderAt(locale: 'pt-BR' | 'en-US') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <PrivacyPolicy />
    </LocaleProvider>,
  )
}

describe('PrivacyPolicy (#398 — página gated de Política de Privacidade)', () => {
  it('pt-BR: renderiza as duas partes do rascunho e o rodapé de status RASCUNHO', () => {
    renderAt('pt-BR')
    expect(screen.getByRole('heading', { level: 1, name: ptBR.privacidade.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.privacidade.parteATitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.privacidade.parteBTitulo })).toBeInTheDocument()
    // Rodapé de versão/data/status (AC #4).
    expect(screen.getByText(ptBR.privacidade.rodapeStatus)).toBeInTheDocument()
    expect(screen.getByText(ptBR.privacidade.rodapeVersao)).toBeInTheDocument()
  })

  it('en-US: renderiza no idioma correto (i18n de verdade, sem string pt hardcoded)', () => {
    renderAt('en-US')
    expect(screen.getByRole('heading', { level: 1, name: enUS.privacidade.titulo })).toBeInTheDocument()
    expect(screen.getByText(enUS.privacidade.rodapeStatus)).toBeInTheDocument()
    // A string pt equivalente NÃO aparece quando o locale é en-US.
    expect(screen.queryByText(ptBR.privacidade.rodapeStatus)).not.toBeInTheDocument()
  })

  it('PUBLICADA: zero placeholder/[validar] no render — nenhum badge de TODO nem chaves cruas', () => {
    const { container } = renderAt('pt-BR')
    // Publicada: nenhum placeholder sobrou → nenhum badge de TODO.
    expect(container.querySelectorAll('[data-todo]').length).toBe(0)
    // E o texto renderizado não contém chaves cruas, nem anotações de rascunho.
    expect(container.textContent).not.toContain('{')
    expect(container.textContent).not.toContain('}')
    expect(container.textContent).not.toContain('[validar')
  })

  it('o e-mail real do encarregado aparece (canal publicado, não placeholder)', () => {
    const { container } = renderAt('pt-BR')
    expect(container.textContent).toContain('privacidade@refogando.com')
  })

  it('paridade de comprimento das listas pt-BR/en-US da seção privacidade', () => {
    const pt = ptBR.privacidade as Record<string, unknown>
    const en = enUS.privacidade as Record<string, unknown>
    for (const key of Object.keys(pt)) {
      const pv = pt[key]
      if (Array.isArray(pv)) {
        expect(Array.isArray(en[key]), `en-US.${key} deve ser array`).toBe(true)
        expect((en[key] as unknown[]).length, `comprimento de ${key}`).toBe(pv.length)
      }
    }
  })
})
