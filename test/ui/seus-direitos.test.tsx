import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom (sem DB) da página PUBLICADA "Seus direitos" + formulário público de intake
 * (#399, GAP-2; parte de #276). Cobre:
 *  - render bilíngue (pt-BR/en-US) do fluxo (Art. 18/19) e do rodapé de status;
 *  - PUBLICAÇÃO: nenhum placeholder sobra (zero `[data-todo]`, zero `{`/`}`), e-mail real presente;
 *  - o formulário: sucesso (POST → 201 → recibo com protocolo) e validação inline (sem round-trip);
 *  - paridade de comprimento das listas pt-BR/en-US da seção.
 */
import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { SeusDireitos } from '@/components/legal/seus-direitos'

const M = ptBR.seusDireitos

function renderAt(locale: Locale) {
  return render(
    <LocaleProvider initialLocale={locale}>
      <SeusDireitos />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SeusDireitos (#399 — página gated + intake)', () => {
  it('pt-BR: renderiza título, fluxo e rodapé de status RASCUNHO', () => {
    renderAt('pt-BR')
    expect(screen.getByRole('heading', { level: 1, name: M.titulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: M.fluxoTitulo })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: M.formTitulo })).toBeInTheDocument()
    expect(screen.getByText(M.rodapeStatus)).toBeInTheDocument()
  })

  it('en-US: renderiza no idioma correto (sem string pt hardcoded)', () => {
    renderAt('en-US')
    expect(
      screen.getByRole('heading', { level: 1, name: enUS.seusDireitos.titulo }),
    ).toBeInTheDocument()
    expect(screen.getByText(enUS.seusDireitos.rodapeStatus)).toBeInTheDocument()
    expect(screen.queryByText(M.rodapeStatus)).not.toBeInTheDocument()
  })

  it('PUBLICADA: zero placeholder/[validar] no render — nenhum badge de TODO nem chaves cruas', () => {
    const { container } = renderAt('pt-BR')
    expect(container.querySelectorAll('[data-todo]').length).toBe(0)
    expect(container.textContent).not.toContain('{')
    expect(container.textContent).not.toContain('}')
    expect(container.textContent).not.toContain('[validar')
  })

  it('o e-mail real do encarregado aparece (canal publicado, não placeholder)', () => {
    const { container } = renderAt('pt-BR')
    expect(container.textContent).toContain('privacidade@refogando.com')
  })

  it('formulário: envio válido → POST /api/legal/takedown e recibo com protocolo', async () => {
    const user = userEvent.setup()
    let sentBody: unknown
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const init = args[1] as RequestInit | undefined
      sentBody = init?.body ? JSON.parse(init.body as string) : undefined
      return {
        ok: true,
        status: 201,
        json: async () => ({ ticketId: 'ticket-uuid-123' }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    renderAt('pt-BR')
    await user.type(screen.getByLabelText(M.formNomeRotulo), 'Cozinha da Vovó')
    await user.type(screen.getByLabelText(M.formPedidoRotulo), 'Removam meu nome, por favor.')
    await user.click(screen.getByRole('button', { name: M.formEnviar }))

    await waitFor(() => expect(screen.getByText('ticket-uuid-123')).toBeInTheDocument())
    expect(screen.getByText(M.formSucessoTitulo)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // o body enviado carrega os campos normalizados (identificação + pedido)
    expect(sentBody).toMatchObject({
      displayName: 'Cozinha da Vovó',
      message: 'Removam meu nome, por favor.',
    })
  })

  it('validação inline: pedido vazio → erro, SEM chamar o servidor', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderAt('pt-BR')
    // sem preencher nada: clicar enviar → erro de pedido, nenhum fetch
    await user.click(screen.getByRole('button', { name: M.formEnviar }))
    expect(await screen.findByText(M.erroPedido)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('validação inline: com pedido mas sem identificador → erro de identificação, SEM fetch', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    renderAt('pt-BR')
    await user.type(screen.getByLabelText(M.formPedidoRotulo), 'quero remover algo')
    await user.click(screen.getByRole('button', { name: M.formEnviar }))
    expect(await screen.findByText(M.erroIdentificacao)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('paridade de comprimento das listas pt-BR/en-US da seção seusDireitos', () => {
    const pt = ptBR.seusDireitos as Record<string, unknown>
    const en = enUS.seusDireitos as Record<string, unknown>
    for (const key of Object.keys(pt)) {
      const pv = pt[key]
      if (Array.isArray(pv)) {
        expect(Array.isArray(en[key]), `en-US.${key} deve ser array`).toBe(true)
        expect((en[key] as unknown[]).length, `comprimento de ${key}`).toBe(pv.length)
      }
    }
  })
})
