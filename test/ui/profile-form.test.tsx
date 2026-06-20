import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'

/**
 * Teste jsdom do formulário de edição de perfil (#124, +handle #128). `fetch` mockado no shape
 * REAL de `/api/me`: GET ({ id, name, email, bio, handle }) carrega o form; PATCH devolve os
 * valores novos. `useSession` mockado (sem Better Auth no jsdom). LocaleProvider real.
 *
 * Asserções: carrega name+bio+handle do GET, email read-only (disabled), salva via PATCH e
 * reflete os valores novos, guard de Visitante (CTA de entrar), en-US, e o FEEDBACK INLINE do
 * handle (taken/reserved/invalid → mensagem específica embaixo do campo).
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

type MeBody = { id: string; name: string; email: string; bio: string | null; handle: string }
type SentPatch = { name: string; bio: string; handle: string }
type FetchResult = { status: number; body?: unknown }

/** Mock de fetch por método; captura o último body de PATCH. */
function mockMe(get: MeBody, patchResult: (sent: SentPatch) => FetchResult) {
  const calls: { method: string; body: unknown }[] = []
  const impl = vi.fn(async (...args: Parameters<typeof fetch>) => {
    const init = args[1] as RequestInit | undefined
    const method = (init?.method ?? 'GET').toUpperCase()
    const sent = init?.body ? JSON.parse(init.body as string) : undefined
    calls.push({ method, body: sent })
    const r: FetchResult =
      method === 'GET' ? { status: 200, body: get } : patchResult(sent as SentPatch)
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    } as Response
  })
  vi.stubGlobal('fetch', impl)
  return { impl, calls }
}

/** GET body completo com defaults — só sobrescreve o que o teste precisa. */
function meBody(over: Partial<MeBody> = {}): MeBody {
  return { id: 'u-1', name: 'Ana', email: 'ana@ex.com', bio: null, handle: 'ana', ...over }
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

  it('carrega name + bio + handle do GET /api/me; email é read-only (disabled)', async () => {
    sessionState = authed()
    mockMe(meBody({ bio: 'Cozinheira.', handle: 'ana-chef' }), () => ({ status: 200 }))
    renderForm('pt-BR')

    const nameInput = await screen.findByLabelText(M.nome)
    expect(nameInput).toHaveValue('Ana')
    expect(screen.getByLabelText(M.bio)).toHaveValue('Cozinheira.')
    expect(screen.getByLabelText(M.handle)).toHaveValue('ana-chef')

    const emailInput = screen.getByLabelText(M.email) as HTMLInputElement
    expect(emailInput).toHaveValue('ana@ex.com')
    expect(emailInput).toBeDisabled()
  })

  it('bio null vira campo vazio (não a string "null")', async () => {
    sessionState = authed()
    mockMe(meBody({ bio: null }), () => ({ status: 200 }))
    renderForm('pt-BR')
    expect(await screen.findByLabelText(M.bio)).toHaveValue('')
  })

  it('salva via PATCH e reflete os valores novos + mensagem de sucesso', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    const { calls } = mockMe(meBody({ bio: null, handle: 'ana' }), (sent) => ({
      status: 200,
      body: meBody({ name: sent.name, bio: sent.bio || null, handle: sent.handle }),
    }))
    renderForm('pt-BR')

    const nameInput = await screen.findByLabelText(M.nome)
    await user.clear(nameInput)
    await user.type(nameInput, 'Maria')
    const bioInput = screen.getByLabelText(M.bio)
    await user.type(bioInput, 'Olá!')

    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.salvo)).toBeInTheDocument())

    // Mandou o PATCH com os valores digitados (incluindo handle).
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body).toMatchObject({ name: 'Maria', bio: 'Olá!', handle: 'ana' })

    // O form reflete os valores retornados.
    expect(screen.getByLabelText(M.nome)).toHaveValue('Maria')
    expect(screen.getByLabelText(M.bio)).toHaveValue('Olá!')
  })

  it('erro genérico do servidor no PATCH → mostra mensagem de erro, sem travar', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe(meBody({ bio: null }), () => ({ status: 400, body: { error: 'nome_invalido' } }))
    renderForm('pt-BR')

    await screen.findByLabelText(M.nome)
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.erro)).toBeInTheDocument())
  })

  it('en-US: rótulos em inglês', async () => {
    sessionState = authed()
    mockMe(meBody({ bio: null }), () => ({ status: 200 }))
    renderForm('en-US')
    expect(await screen.findByLabelText(enUS.perfil.nome)).toBeInTheDocument()
    expect(screen.getByLabelText(enUS.perfil.bio)).toBeInTheDocument()
    expect(screen.getByLabelText(enUS.perfil.handle)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: enUS.perfil.salvar })).toBeInTheDocument()
  })
})

describe('ProfileForm — feedback inline do handle (#128)', () => {
  it('handle em uso (409 handle_taken) → mensagem específica embaixo do campo', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe(meBody({ handle: 'ana' }), () => ({ status: 409, body: { error: 'handle_taken' } }))
    renderForm('pt-BR')

    const handleInput = await screen.findByLabelText(M.handle)
    await user.clear(handleInput)
    await user.type(handleInput, 'tomado')
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.handleEmUso)).toBeInTheDocument())
    // Não é o erro genérico do form.
    expect(screen.queryByText(M.erro)).not.toBeInTheDocument()
    expect(handleInput).toHaveAttribute('aria-invalid', 'true')
  })

  it('handle reservado (400 handle_reserved) → mensagem específica', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe(meBody({ handle: 'ana' }), () => ({ status: 400, body: { error: 'handle_reserved' } }))
    renderForm('pt-BR')

    const handleInput = await screen.findByLabelText(M.handle)
    await user.clear(handleInput)
    await user.type(handleInput, 'admin')
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.handleReservado)).toBeInTheDocument())
    expect(screen.queryByText(M.erro)).not.toBeInTheDocument()
  })

  it('handle inválido (400 handle_invalid) → mensagem específica', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe(meBody({ handle: 'ana' }), () => ({ status: 400, body: { error: 'handle_invalid' } }))
    renderForm('pt-BR')

    const handleInput = await screen.findByLabelText(M.handle)
    await user.clear(handleInput)
    await user.type(handleInput, 'ab')
    await user.click(screen.getByRole('button', { name: M.salvar }))

    await waitFor(() => expect(screen.getByText(M.handleInvalido)).toBeInTheDocument())
    expect(screen.queryByText(M.erro)).not.toBeInTheDocument()
  })

  it('editar o handle limpa o erro inline anterior', async () => {
    const user = userEvent.setup()
    sessionState = authed()
    mockMe(meBody({ handle: 'ana' }), () => ({ status: 409, body: { error: 'handle_taken' } }))
    renderForm('pt-BR')

    const handleInput = await screen.findByLabelText(M.handle)
    await user.clear(handleInput)
    await user.type(handleInput, 'tomado')
    await user.click(screen.getByRole('button', { name: M.salvar }))
    await waitFor(() => expect(screen.getByText(M.handleEmUso)).toBeInTheDocument())

    // Ao digitar de novo, o erro some (o campo volta a mostrar a dica).
    await user.type(handleInput, '-2')
    expect(screen.queryByText(M.handleEmUso)).not.toBeInTheDocument()
  })
})
