import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom da página placeholder `/plano` (Fase 2 de billing, flag-off — ver
 * `docs/reports/fase2-billing-decisao.md` §6 item 5). Destino do CTA estático do cartão de upsell
 * no limite de cota. Cobre: título/corpo bilíngues (i18n real, nada hardcoded), o link "voltar"
 * aponta pro caminho canônico `/{locale}` (ADR-0020), e — a garantia mais importante do texto —
 * NUNCA afirma preço ou data.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { PlanoPlaceholder } from '@/components/plano/plano-placeholder'

function renderAt(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <PlanoPlaceholder />
    </LocaleProvider>,
  )
}

describe('PlanoPlaceholder (Fase 2 de billing, flag-off)', () => {
  it('pt-BR: título + corpo + link "voltar" pra /pt-BR', () => {
    renderAt('pt-BR')
    expect(screen.getByRole('heading', { level: 1, name: ptBR.plano.titulo })).toBeInTheDocument()
    expect(screen.getByText(ptBR.plano.corpo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.plano.voltar })).toHaveAttribute('href', '/pt-BR')
  })

  it('en-US: renderiza no idioma correto (i18n real, sem string pt hardcoded)', () => {
    renderAt('en-US')
    expect(screen.getByRole('heading', { level: 1, name: enUS.plano.titulo })).toBeInTheDocument()
    expect(screen.queryByText(ptBR.plano.titulo)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS.plano.voltar })).toHaveAttribute('href', '/en-US')
  })

  it('NUNCA afirma preço nem data específica (só "em breve"/"preparando")', () => {
    const { container } = renderAt('pt-BR')
    const text = container.textContent ?? ''
    // Nenhum símbolo de moeda nem "R$"/dígitos de preço no corpo.
    expect(text).not.toMatch(/R\$\s?\d/)
    expect(text).not.toMatch(/\$\d/)
  })
})
