import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Render por papel do Console (#63, AC5 parcial). Teste de COMPONENTE jsdom (seam #54): as
 * seções montadas fazem `fetch` na montagem — mockamos `fetch` devolvendo listas vazias para
 * todas as rotas GET, e afirmamos a presença/ausência dos HEADINGS por papel. A matriz de
 * gating (quem CHEGA a ver o console) é o teste node `test/server/admin-access.test.ts`; o
 * despacho do `page.tsx` usa `headers()`/`getSession`, que o jsdom não alcança.
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
import { AdminConsole } from '@/components/admin/admin-console'
import { AccessDenied } from '@/components/admin/access-denied'

/** Mocka `fetch` devolvendo listas vazias no shape REAL de cada rota GET do console. */
function mockEmptyFetch() {
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    let body: unknown = {}
    if (url.includes('/api/admin/config')) body = { defaultModel: 'claude-opus-4-8' }
    else if (url.includes('/api/curate/reports')) body = { reports: [] }
    else if (url.includes('/api/curate/translations/stale')) body = { stale: [] }
    else if (url.includes('/api/curate/promotion')) body = { promotion: [] }
    return { ok: true, status: 200, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const A = ptBR.admin

describe('AdminConsole — render por papel (#63 AC5)', () => {
  it('admin vê TODAS as seções (6 headings)', async () => {
    mockEmptyFetch()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <AdminConsole role="admin" />
      </LocaleProvider>,
    )

    expect(screen.getByRole('heading', { level: 1, name: A.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: A.configTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: A.papeisTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.moderacao.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.traducoesStale.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.curadoria.titulo })).toBeInTheDocument()
  })

  it('curador NÃO vê Config nem Papéis (escondidos, não desabilitados)', () => {
    mockEmptyFetch()
    render(
      <LocaleProvider initialLocale="pt-BR">
        <AdminConsole role="curador" />
      </LocaleProvider>,
    )

    // Seções de Curador presentes.
    expect(screen.getByRole('heading', { name: ptBR.moderacao.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.traducoesStale.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: ptBR.curadoria.titulo })).toBeInTheDocument()

    // Admin-only AUSENTE do DOM (escondido), não só desabilitado.
    expect(screen.queryByRole('heading', { name: A.configTitulo })).toBeNull()
    expect(screen.queryByRole('heading', { name: A.papeisTitulo })).toBeNull()
    // Sem os selects admin-only de modelo/papel (a Curadoria, visível ao Curador, tem os
    // próprios selects do form de criação — por isso miramos os admin-only por nome).
    expect(screen.queryByRole('combobox', { name: A.modeloLabel })).toBeNull()
    expect(screen.queryByRole('combobox', { name: A.papelLabel })).toBeNull()
  })

  it('AccessDenied: título + link de volta ao início', () => {
    render(
      <LocaleProvider initialLocale="pt-BR">
        <AccessDenied />
      </LocaleProvider>,
    )
    expect(screen.getByRole('heading', { name: A.acessoNegadoTitulo })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: A.voltarInicio })).toHaveAttribute('href', '/')
  })
})
