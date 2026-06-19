import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { DerivedDiff } from '@/domain/recipe-diff'

/**
 * Teste jsdom da vista do DIFF da derivada (#61). Componente PURO de render: recebe o
 * `DerivedDiff` congelado + `vinculoPerdido`. LocaleProvider real. Asserções: rótulos
 * adicionado/removido/quantidade alterada (NEUTROS), nota de vínculo perdido, en-US, sem âmbar.
 */

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { RecipeDiffView } from '@/components/recipe/recipe-diff-view'

const M = ptBR.derivada

function diff(over: Partial<DerivedDiff> = {}): DerivedDiff {
  return {
    v: 1,
    ingredientes: {
      adicionados: ['gengibre'],
      removidos: ['pimenta'],
      quantidadeAlterada: [{ nome: 'sal', de: '1.000', para: '2.000' }],
    },
    restricoes: { adicionadas: ['vegano'], removidas: [] },
    campos: { titulo: { de: 'Velho', para: 'Novo' } },
    ...over,
  }
}

function renderDiff(d: DerivedDiff, opts: { vinculoPerdido?: boolean; locale?: Locale } = {}) {
  const { vinculoPerdido = false, locale = 'pt-BR' } = opts
  return render(
    <LocaleProvider initialLocale={locale}>
      <RecipeDiffView diff={d} vinculoPerdido={vinculoPerdido} />
    </LocaleProvider>,
  )
}

describe('RecipeDiffView (#61)', () => {
  it('T1 — renderiza adicionado/removido/quantidade alterada (NEUTROS, sem âmbar)', () => {
    const { container } = renderDiff(diff())
    expect(screen.getAllByText(M.adicionado).length).toBeGreaterThan(0)
    expect(screen.getAllByText(M.removido).length).toBeGreaterThan(0)
    expect(screen.getByText(M.quantidadeAlterada)).toBeInTheDocument()
    expect(screen.getByText('gengibre')).toBeInTheDocument()
    expect(screen.getByText('pimenta')).toBeInTheDocument()
    expect(screen.getByText(/sal:/)).toBeInTheDocument()
    // Restrição alterada presente.
    expect(screen.getByText(M.restricaoAlterada)).toBeInTheDocument()
    // Único <h1>? Este componente NÃO emite <h1> (o detalhe o faz) — só <h2>.
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h2')).not.toBeNull()
    // ADR-0004: sem âmbar.
    expect(container.querySelector('[class*="aviso"]')).toBeNull()
  })

  it('T2 — vínculo perdido: mostra a nota (#289)', () => {
    renderDiff(diff(), { vinculoPerdido: true })
    expect(screen.getByText(ptBR.edicaoPropria.vinculoPerdido)).toBeInTheDocument()
  })

  it('T3 — campos textuais alterados aparecem (titulo de→para)', () => {
    renderDiff(diff())
    expect(screen.getByText(/Velho → Novo/)).toBeInTheDocument()
  })

  it('T4 — en-US: rótulos do diff traduzidos', () => {
    renderDiff(diff(), { locale: 'en-US' })
    expect(screen.getAllByText(enUS.derivada.adicionado).length).toBeGreaterThan(0)
    expect(screen.getByText(enUS.derivada.quantidadeAlterada)).toBeInTheDocument()
  })
})
