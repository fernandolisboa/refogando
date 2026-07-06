import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Fase 2 (#466) — teste de COMPONENTE jsdom (seam #54) das seções da aba "Plano": `PlanConfigSection`
 * (edita proCaps via GET/PUT /api/admin/config) e `UserPlanSection` (concede plano via POST
 * /api/admin/user-plan). `fetch` mockado no shape REAL das rotas. Não mocka next/navigation (as
 * seções não navegam — se alguém adicionar router, o jsdom lança).
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { PlanConfigSection } from '@/components/admin/plan-config-section'
import { UserPlanSection } from '@/components/admin/user-plan-section'
import type { ProCaps } from '@/domain/pro-caps'

const A = ptBR.admin

type FetchResult = { ok: boolean; status: number; body: unknown } | { reject: true }
function mockFetch(routes: Record<string, FetchResult | FetchResult[]>) {
  const calls: { method: string; url: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const url = String(args[0])
    const method = (args[1]?.method ?? 'GET').toUpperCase()
    calls.push({ method, url, body: args[1]?.body })
    const entry = routes[`${method} ${url}`]
    if (entry === undefined) throw new Error(`fetch não mockado: ${method} ${url}`)
    const r = Array.isArray(entry) ? (entry.length > 1 ? entry.shift()! : entry[0]) : entry
    if ('reject' in r) throw new TypeError('network down')
    return { ok: r.ok, status: r.status, json: async () => r.body } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderPlanConfig() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <PlanConfigSection />
    </LocaleProvider>,
  )
}
function renderUserPlan() {
  return render(
    <LocaleProvider initialLocale="pt-BR">
      <UserPlanSection />
    </LocaleProvider>,
  )
}

const okProCaps: ProCaps = {
  recipeGen: { usuario: 30, curador: 60, admin: null },
  imageGen: { usuario: 15, curador: 30, admin: null },
  extraction: { usuario: 300, curador: 600, admin: null },
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlanConfigSection — proCaps', () => {
  it('proCaps=null: interruptor desligado e campos desabilitados', async () => {
    mockFetch({ 'GET /api/admin/config': { ok: true, status: 200, body: { proCaps: null } } })
    renderPlanConfig()
    const toggle = await screen.findByRole('checkbox', { name: A.planoProAtivarLabel })
    expect(toggle).not.toBeChecked()
    // Os campos de teto ficam desabilitados enquanto a tabela pro está desligada.
    const receita = screen.getByRole('group', { name: A.planoProReceitaLabel })
    expect(within(receita).getByRole('spinbutton', { name: A.papelUsuario })).toBeDisabled()
  })

  it('desligado: salvar envia proCaps: null (limpa a tabela pro)', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { proCaps: null } },
      'PUT /api/admin/config': { ok: true, status: 200, body: { proCaps: null } },
    })
    renderPlanConfig()
    await screen.findByRole('checkbox', { name: A.planoProAtivarLabel })
    await userEvent.click(screen.getByRole('button', { name: A.salvar }))
    await waitFor(() => expect(screen.getByText(A.salvo)).toBeInTheDocument())
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body))).toEqual({ proCaps: null })
  })

  it('proCaps bundle: interruptor ligado, valores refletidos; salvar reenvia o bundle', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { proCaps: okProCaps } },
      'PUT /api/admin/config': { ok: true, status: 200, body: { proCaps: okProCaps } },
    })
    renderPlanConfig()
    const toggle = await screen.findByRole('checkbox', { name: A.planoProAtivarLabel })
    expect(toggle).toBeChecked()
    const imagem = screen.getByRole('group', { name: A.planoProImagemLabel })
    expect(within(imagem).getByRole('spinbutton', { name: A.papelUsuario })).toHaveValue(15)

    await userEvent.click(screen.getByRole('button', { name: A.salvar }))
    await waitFor(() => expect(screen.getByText(A.salvo)).toBeInTheDocument())
    const put = calls.find((c) => c.method === 'PUT')!
    expect(JSON.parse(String(put.body))).toEqual({ proCaps: okProCaps })
  })

  it('ligado com teto inválido: bloqueia no cliente (sem PUT) e mostra erro', async () => {
    const { calls } = mockFetch({
      'GET /api/admin/config': { ok: true, status: 200, body: { proCaps: okProCaps } },
    })
    renderPlanConfig()
    await screen.findByRole('checkbox', { name: A.planoProAtivarLabel })
    const receita = screen.getByRole('group', { name: A.planoProReceitaLabel })
    const usuario = within(receita).getByRole('spinbutton', { name: A.papelUsuario })
    await userEvent.clear(usuario)
    await userEvent.type(usuario, '-5')
    await userEvent.click(screen.getByRole('button', { name: A.salvar }))
    expect(screen.getByText(A.planoErroConfig)).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
  })
})

describe('UserPlanSection — conceder/reverter', () => {
  it('conceder Pro por @handle envia o corpo certo e mostra sucesso', async () => {
    const { calls } = mockFetch({
      'POST /api/admin/user-plan': {
        ok: true,
        status: 200,
        body: { user: { name: 'Alvo', handle: 'chef', email: 'a@x.test', plan: 'pro' } },
      },
    })
    renderUserPlan()
    await userEvent.type(screen.getByLabelText(A.planoIdentificadorLabel), '@chef')
    await userEvent.click(screen.getByRole('button', { name: A.planoBotaoPro }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    const post = calls.find((c) => c.method === 'POST')!
    expect(JSON.parse(String(post.body))).toEqual({ identifier: '@chef', plan: 'pro' })
    expect(screen.getByRole('status').textContent).toContain('@chef')
    expect(screen.getByRole('status').textContent).toContain(A.planoPlanoPro)
  })

  it('usuário inexistente → mostra erro de não encontrado', async () => {
    mockFetch({
      'POST /api/admin/user-plan': {
        ok: false,
        status: 404,
        body: { error: 'usuario_nao_encontrado' },
      },
    })
    renderUserPlan()
    await userEvent.type(screen.getByLabelText(A.planoIdentificadorLabel), '@fantasma')
    await userEvent.click(screen.getByRole('button', { name: A.planoBotaoPro }))
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert').textContent).toBe(A.planoErroNaoEncontrado)
  })
})
