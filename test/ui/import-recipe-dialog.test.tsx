import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

/**
 * Teste de COMPONENTE jsdom do modal de importação (#169, ADR-0019) — o nó PURO de i18n
 * `ImportRecipeDialog` isolado (rótulos já localizados, callback de navegação injetado). Os polyfills
 * de ponteiro/ResizeObserver do Radix vêm de test/ui/setup.ts (a primitiva é a mesma Dialog do Sheet).
 * Cobre o que os testes da Busca não cobrem: ramo OTIMISTA durante o sessionPending e o erro genérico.
 */

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}))

import { ImportRecipeDialog, type ImportDialogLabels, type WebLink } from '@/components/recipe/import-recipe-dialog'
import { ptBR } from '@/i18n/messages/pt-BR'

const m = ptBR.busca
const LINK: WebLink = {
  title: 'Feijoada Completa',
  url: 'https://tudogostoso.com.br/feijoada',
  sourceName: 'TudoGostoso',
}

const LABELS: ImportDialogLabels = {
  titulo: m.importarTitulo,
  texto: m.importarTexto,
  confirmar: m.importarConfirmar,
  verNoSite: m.importarVerNoSite,
  cancelar: m.importarCancelar,
  importando: m.importarImportando,
  erroNaoImportavel: m.importarErroNaoImportavel,
  erroGenerico: m.importarErroGenerico,
  conviteTitulo: m.importarConviteTitulo,
  conviteTexto: m.importarConviteTexto,
  signInLabel: ptBR.nav.signIn,
  daWebFonte: m.daWebFonte,
}

function renderDialog(over: Partial<Parameters<typeof ImportRecipeDialog>[0]> = {}) {
  const onImported = vi.fn()
  render(
    <ImportRecipeDialog
      link={LINK}
      authed={true}
      sessionPending={false}
      labels={LABELS}
      onImported={onImported}
      {...over}
    />,
  )
  return { onImported }
}

function stubFetch(status: number, body: unknown = {}) {
  const impl = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }))
  vi.stubGlobal('fetch', impl as unknown as typeof fetch)
  return impl
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ImportRecipeDialog (#169)', () => {
  it('fechado por padrão: gatilho com aria-expanded=false e a atribuição "da web · <fonte>"', () => {
    renderDialog()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    const trigger = screen.getByRole('button', { name: new RegExp(LINK.title) })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(
      screen.getByText(m.daWebFonte.replace('{fonte}', LINK.sourceName)),
    ).toBeInTheDocument()
  })

  it('sessionPending: ramo OTIMISTA (logado) — mostra confirmar, NÃO o convite de entrar', async () => {
    stubFetch(201, { recipeId: 'x' })
    const user = userEvent.setup()
    renderDialog({ authed: false, sessionPending: true })
    await user.click(screen.getByRole('button', { name: new RegExp(LINK.title) }))
    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: m.importarConfirmar })).toBeInTheDocument()
    expect(screen.queryByText(m.importarConviteTitulo)).not.toBeInTheDocument()
  })

  it('erro de rede (fetch lança): mostra o erro GENÉRICO e NÃO navega', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    )
    const user = userEvent.setup()
    const { onImported } = renderDialog()
    await user.click(screen.getByRole('button', { name: new RegExp(LINK.title) }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: m.importarConfirmar }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(m.importarErroGenerico)
    expect(onImported).not.toHaveBeenCalled()
  })

  it('cancelar fecha o modal sem importar', async () => {
    const fetchMock = stubFetch(201, { recipeId: 'x' })
    const user = userEvent.setup()
    renderDialog()
    await user.click(screen.getByRole('button', { name: new RegExp(LINK.title) }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: m.importarCancelar }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
