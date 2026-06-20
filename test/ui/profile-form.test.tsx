import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do formulário de edição de perfil (#124). `fetch` mockado no shape REAL de
 * `/api/me`: GET ({ id, name, email, bio }) carrega o form; PATCH devolve os valores novos.
 * `useSession` mockado (sem Better Auth no jsdom). LocaleProvider real.
 *
 * Asserções: carrega name+bio do GET, email read-only (disabled), salva via PATCH e reflete
 * os valores novos, guard de Visitante (CTA de entrar), en-US.
 */

type SessionState = { data: unknown; error: unknown; isPending: boolean }
let sessionState: SessionState
vi.mock('@/lib/auth-client', () => ({
  useSession: () => sessionState,
}))

import { LocaleProvider } from '@/i18n/provider'
import { ptBR } from '@/i18n/messages/pt-BR'
import { enUS } from '@/i18n/messages/en-US'
import type { Locale } from '@/i18n/locale'
import { ProfileForm } from '@/components/profile/profile-form'

const M = ptBR.perfil

function authed(): SessionState {
  return { data: { user: { id: 'u-1' } }, error: null, isPending: false }
}
function guest(): SessionState {
  return { data: null, error: null, isPending: false }
}

type MeBody = { id: string; name: string; email: string; bio: string | null }
type FetchResult = { status: number; body?: unknown }

/** Mock de fetch por método; captura o último body de PATCH. */
function mockMe(get: MeBody, patchResult: (sent: { name: string; bio: string }) => FetchResult) {
  const calls: { method: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const sent = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, body: sent })
    const r: FetchResult =
      method === 'GET' ? { status: 200, body: get } : patchResult(sent as { name: string; bio: string })
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

function renderForm(locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <ProfileForm />
    </LocaleProvider>,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ProfileForm — edição de nome + bio (#124)', () => {
  it('Visitante: mostra CTA de entrar, sem form', () => {
    sessionState = guest()
    renderForm('pt-BR')
    expect(screen.getByText(M.precisaEntrar)).toBeInTheDocument()
    expect(screen.queryByLabelText(M.nome)).not.toBeInTheDocument()
  })

  it('carrega name + bio do GET /api/me; email é read-only (disabled)', async () => {
    sessionState = authed()
    mockMe({ id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: 'Cozinheira.' }, () => ({
      status: 200,
    }))
    renderForm('pt-BR')

    const nameInput = await screen.findByLabelText(M.nome)
    expect(nameInput).toHaveValue('Ana')
    expect(screen.getByLabelText(M.bio)).toHaveValue('Cozinheira.')

    const emailInput = screen.getByLabelText(M.email) as HTMLInputElement
    expect(emailInput).toHaveValue('ana@ex.com')
    expect(emailInput).toBeDisabled()
  })

  it('bio null vira campo vazio (não a string "null")', async () => {
    sessionState = authed()
    mockMe({ id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: null }, () => ({ status: 200 }))
    renderForm('pt-BR')
    expect(await screen.findByLabelText(M.bio)).toHaveValue('')
  })

  it('salva via PATCH e reflete os valores novos + mensagem de sucesso', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    const { calls } = mockMe(
      { id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: null },
      (sent) => ({ status: 200, body: { id: 'u-1', name: sent.name, email: 'ana@ex.com', bio: sent.bio || null } }),
    )
    renderForm('pt-BR')

    const nameInput = await screen.findByLabelText(M.nome)
    await user.clear(nameInput)
    await user.type(nameInput, 'Maria')
    const bioInput = screen.getByLabelText(M.bio)
    await user.type(bioInput, 'Olá!')

    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.salvo)).toBeInTheDocument())

    // Mandou o PATCH com os valores digitados.
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body).toMatchObject({ name: 'Maria', bio: 'Olá!' })

    // O form reflete os valores retornados.
    expect(screen.getByLabelText(M.nome)).toHaveValue('Maria')
    expect(screen.getByLabelText(M.bio)).toHaveValue('Olá!')
  })

  it('erro do servidor no PATCH → mostra mensagem de erro, sem travar', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe({ id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: null }, () => ({
      status: 400,
      body: { error: 'nome_invalido' },
    }))
    renderForm('pt-BR')

    await screen.findByLabelText(M.nome)
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.erro)).toBeInTheDocument())
  })

  it('en-US: rótulos em inglês', async () => {
    sessionState = authed()
    mockMe({ id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: null }, () => ({ status: 200 }))
    renderForm('en-US')
    expect(await screen.findByLabelText(enUS.perfil.nome)).toBeInTheDocument()
    expect(screen.getByLabelText(enUS.perfil.bio)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.perfil.salvar })).toBeInTheDocument()
  })
})
