import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom do cartão de upsell no limite de cota (Fase 2 de billing, flag-off — ver
 * `docs/reports/fase2-billing-decisao.md` §6 item 5). Isolado dos 4+ pontos que o consomem
 * (geração, regenerar, imagem): cobre o CONTRATO do componente em si — texto vem do i18n
 * (bilíngue), o CTA é um LINK estático (sem `onClick`/fetch) pro `/{locale}/plano`, e o cartão é
 * anunciável (role=status) sem ser um erro (não é role=alert).
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
import { QuotaUpsellCard } from '@/components/recipe/quota-upsell-card'

function renderAt(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <QuotaUpsellCard />
    </LocaleProvider>,
  )
}

describe('QuotaUpsellCard (Fase 2 de billing, flag-off)', () => {
  it('pt-BR: título/descrição/CTA vêm do i18n; CTA é um link estático pra /pt-BR/plano', () => {
    renderAt('pt-BR')
    expect(screen.getByText(ptBR.upsell.titulo)).toBeInTheDocument()
    expect(screen.getByText(ptBR.upsell.descricao)).toBeInTheDocument()
    const cta = screen.getByRole('link', { name: ptBR.upsell.cta })
    expect(cta).toHaveAttribute('href', '/pt-BR/plano')
  })

  it('en-US: mesmo contrato, traduzido — sem string pt hardcoded', () => {
    renderAt('en-US')
    expect(screen.getByText(enUS.upsell.titulo)).toBeInTheDocument()
    expect(screen.queryByText(ptBR.upsell.titulo)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: enUS.upsell.cta })).toHaveAttribute('href', '/en-US/plano')
  })

  it('é anunciável mas NÃO é um erro (role=status, não role=alert)', () => {
    renderAt('pt-BR')
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
