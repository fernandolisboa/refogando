import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste jsdom dos controles de versão por linhagem / regenerar (#20 UI / #61). `fetch` mockado no
 * shape REAL de `POST /api/recipes/[id]/regenerate`. `next/navigation` real-mock (router.push).
 * Asserções: 201 → navega pra nova versão; 409 sem_fonte → mensagem graceful; 200 impossible →
 * mensagem; 502 invalid → erro; en-US; sem âmbar. `@/lib/auth-client` mockado (Fase 2 de billing,
 * flag-off): este componente só monta pro DONO — a sessão sempre presente decide o upsell de limite.
 */

const push = vi.fn()
const refresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

const authMock = vi.hoisted(() => ({
  session: { data: { user: { id: 'owner-1', plan: 'free' as string | undefined } }, isPending: false, error: null as unknown },
}))
vi.mock('@/lib/auth-client', () => ({
  useSession: () => authMock.session,
}))
function setPlan(plan: string | undefined) {
  authMock.session = { data: { user: { id: 'owner-1', plan } }, isPending: false, error: null }
}

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { LineageVersionControls } from '@/components/recipe/lineage-version-controls'

const M = ptBR.versao

function mockRegen(result: { status: number; body?: unknown }) {
  const impl = vi.fn(async (input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    void _init
    if (!String(input).includes('/regenerate')) throw new Error(`fetch não mockado: ${String(input)}`)
    return {
      ok: result.status >= 200 && result.status < 300,
      status: result.status,
      json: async () => result.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return impl
}

function renderControls(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <LineageVersionControls recipeId="r-1" />
    </LocaleProvider>,
  )
}

beforeEach(() => {
  setPlan('free')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  push.mockClear()
  refresh.mockClear()
})

describe('LineageVersionControls (#20/#61)', () => {
  it('T1 — 201: cria nova versão e navega pra ela', async () => {
    const user = userEvent.setup()
    const fetchMock = mockRegen({ status: 201, body: { recipeId: 'v2', outcome: 'success', advisory: null } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    const call = fetchMock.mock.calls[0]
    expect(String(call[0])).toBe('/api/recipes/r-1/regenerate')
    expect((call[1] as RequestInit).method).toBe('POST')
    // #231 (ADR-0020): o 201 não devolve slug ⇒ navega pro fallback canônico locale-no-caminho
    // `/{locale}/recipes/<uuid>` (que 308a pro slug); provider sob 'pt-BR'. Nunca link nu.
    expect(push).toHaveBeenCalledWith('/pt-BR/recipes/v2')
  })

  it('T2 — 409 sem_fonte: mensagem graceful, NÃO navega', async () => {
    const user = userEvent.setup()
    mockRegen({ status: 409, body: { error: 'sem_fonte_para_regenerar' } })
    const { container } = renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(M.semFonte)
    expect(push).not.toHaveBeenCalled()
    expect(container.querySelector('[class*="aviso"]')).toBeNull()
  })

  it('T3 — 200 impossible: mensagem honesta (sem Receita nova)', async () => {
    const user = userEvent.setup()
    mockRegen({ status: 200, body: { outcome: 'impossible', advisory: null } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.criar.resultadoImpossivel)
    expect(push).not.toHaveBeenCalled()
  })

  it('T4 — 502 invalid: erro de geração', async () => {
    const user = userEvent.setup()
    mockRegen({ status: 502, body: { outcome: 'invalid', error: 'geracao_invalida' } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.criar.erroGeracao)
  })

  it('T5 — en-US: botão regenerar traduzido', () => {
    renderControls('en-US')
    expect(screen.getByRole('button', { name: enUS.versao.regenerar })).toBeInTheDocument()
  })

  it('T6 — 429 limite_geracao (#167): mensagem AMIGÁVEL de limite, NÃO navega', async () => {
    const user = userEvent.setup()
    mockRegen({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    // Mensagem amigável (a mesma do POST /api/generations), não o erro cru de geração.
    expect(await screen.findByRole('alert')).toHaveTextContent(ptBR.criar.erroLimiteGeracao)
    expect(push).not.toHaveBeenCalled()
  })

  it('Fase 2 (flag-off) — 429 limite_geracao + dono `free`: cartão de upsell junto da mensagem', async () => {
    const user = userEvent.setup()
    setPlan('free')
    mockRegen({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    await screen.findByRole('alert')
    expect(screen.getByText(ptBR.upsell.titulo)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: ptBR.upsell.cta })).toHaveAttribute('href', '/pt-BR/plano')
  })

  it('Fase 2 (flag-off) — 429 limite_geracao + dono `pro`: SEM cartão de upsell', async () => {
    const user = userEvent.setup()
    setPlan('pro')
    mockRegen({ status: 429, body: { error: 'limite_geracao', retryAfterMs: 3600000 } })
    renderControls()
    await user.click(screen.getByRole('button', { name: M.regenerar }))
    await screen.findByRole('alert')
    expect(screen.queryByText(ptBR.upsell.titulo)).not.toBeInTheDocument()
  })
})
