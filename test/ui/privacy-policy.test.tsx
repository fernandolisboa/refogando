import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom (sem DB) da página de Política de Privacidade GATED (#398 / #276). Cobre:
 *  - render bilíngue das DUAS partes do rascunho (Parte a + Parte b);
 *  - placeholders `{...}` renderizados como BADGE de TODO visível, NUNCA como texto final com chaves;
 *  - rodapé de status "RASCUNHO — aguardando revisão jurídica";
 *  - AC #5: a página declara a PENDÊNCIA do canal de takedown (não anuncia um canal inexistente);
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

  it('placeholders viram BADGE de TODO visível — nenhum "{" ou "}" publicado como texto final', () => {
    const { container } = renderAt('pt-BR')
    // Há pelo menos um badge de TODO (ex.: {e-mail do encarregado}, {razão social}).
    const todos = container.querySelectorAll('[data-todo]')
    expect(todos.length).toBeGreaterThan(0)
    // E o texto renderizado inteiro não contém chaves cruas (guarda contra "texto final" com {…}).
    expect(container.textContent).not.toContain('{')
    expect(container.textContent).not.toContain('}')
  })

  it('AC #5: declara a PENDÊNCIA do canal de takedown (não anuncia canal inexistente)', () => {
    renderAt('pt-BR')
    const nota = screen.getByText(/não existe canal público/i)
    expect(nota).toBeInTheDocument()
    // A pendência aparece dentro de um bloco role="note" (aviso), não como direito consumado.
    expect(nota.closest('[role="note"]')).not.toBeNull()
  })

  it('o contato do encarregado é placeholder (não uma promessa de e-mail ativo)', () => {
    renderAt('pt-BR')
    // O e-mail do encarregado aparece como badge de TODO, com o rótulo acessível "campo a preencher".
    const badge = screen.getAllByTitle(ptBR.privacidade.todoRotulo)
    expect(badge.length).toBeGreaterThan(0)
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
