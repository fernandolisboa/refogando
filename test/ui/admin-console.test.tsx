import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Tela de acesso negado do Console (#63 → #125). O antigo render-por-papel do `AdminConsole`
 * (monolito) virou rotas aninhadas (#125): a visibilidade por papel das seções é provada por
 * `admin-section-nav.test.tsx` (links) + o gate de rota (`admin-routes-gate.test.ts`). Aqui
 * fica só a `AccessDenied` — o que o layout/page renderiza no veredito `denied`.
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
import { AccessDenied } from '@/components/admin/access-denied'

const A = ptBR.admin

describe('AccessDenied — veredito `denied` do Console', () => {
  it('título + link de volta ao início', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <AccessDenied />
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { name: A.acessoNegadoTitulo })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: A.voltarInicio })).toHaveAttribute('href', '/')
  })
})
