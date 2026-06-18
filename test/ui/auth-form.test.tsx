import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

// Navegação: espiões pra provar push('/') + refresh() pós-sucesso (anti-stale).
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

// signIn/signUp são proxies de caminho: .email / .social. Mock ANINHADO (não spy plano).
const signInEmail = vi.fn()
const signInSocial = vi.fn()
const signUpEmail = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  useSession: () => ({ data: null, error: null, isPending: false, isRefetching: false, refetch: vi.fn() }),
  signIn: { email: (...a: unknown[]) => signInEmail(...a), social: (...a: unknown[]) => signInSocial(...a) },
  signUp: { email: (...a: unknown[]) => signUpEmail(...a) },
  signOut: vi.fn(),
}))

import { LocaleProvider } from '@/i18n/provider'
import { AuthForm } from '@/components/auth/auth-form'
import type { Locale } from '@/i18n/locale'

type Mode = 'sign-in' | 'sign-up'
type Handlers = {
  onSuccess?: () => void
  onError?: (ctx: { error: { code?: string } }) => void
}

function renderForm(mode: Mode, googleEnabled = false, locale: Locale = 'pt-BR') {
  return render(
    <LocaleProvider initialLocale={locale}>
      <AuthForm mode={mode} googleEnabled={googleEnabled} />
    </LocaleProvider>,
  )
}

/** Faz o mock invocar onSuccess (sucesso simulado). */
const succeed = (fn: ReturnType<typeof vi.fn>) =>
  fn.mockImplementation(async (_body: unknown, handlers?: Handlers) => {
    handlers?.onSuccess?.()
    return { data: {}, error: null }
  })

/** Faz o mock invocar onError com um code (erro simulado). */
const failWith = (fn: ReturnType<typeof vi.fn>, code: string) =>
  fn.mockImplementation(async (_body: unknown, handlers?: Handlers) => {
    handlers?.onError?.({ error: { code } })
    return { data: null, error: { code } }
  })

describe('AuthForm — entrar/criar consumindo /api/auth (#55)', () => {
  beforeEach(() => {
    push.mockClear()
    refresh.mockClear()
    signInEmail.mockReset()
    signInSocial.mockReset()
    signUpEmail.mockReset()
  })

  it('entrar: labels associados aos inputs (a11y)', () => {
    renderForm('sign-in')
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password')
    // sign-in não tem campo Nome.
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()
  })

  it('entrar: submissão chama signIn.email com as credenciais', async () => {
    const user = userEvent.setup()
    succeed(signInEmail)
    renderForm('sign-in')

    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(signInEmail).toHaveBeenCalledTimes(1)
    expect(signInEmail.mock.calls[0][0]).toMatchObject({ email: 'ana@ex.com', password: 'segredo123' })
  })

  it('entrar: sucesso navega pra / e revalida', async () => {
    const user = userEvent.setup()
    succeed(signInEmail)
    renderForm('sign-in')

    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(push).toHaveBeenCalledWith('/')
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('entrar: credencial inválida mostra erro claro (neutro, não-aviso)', async () => {
    const user = userEvent.setup()
    failWith(signInEmail, 'INVALID_EMAIL_OR_PASSWORD')
    renderForm('sign-in')

    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'errada')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Email ou senha incorretos.')
    // Cor neutra text-fg — NÃO o token aviso (reservado pro Aviso de restrição).
    expect(alert.className).toMatch(/text-fg/)
    expect(alert.className).not.toMatch(/aviso/)
    expect(push).not.toHaveBeenCalled()
  })

  it('criar conta: campo Nome + signUp.email recebe name/email/password', async () => {
    const user = userEvent.setup()
    succeed(signUpEmail)
    renderForm('sign-up')

    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Nome'), 'Ana Maria')
    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo123')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(signUpEmail).toHaveBeenCalledTimes(1)
    expect(signUpEmail.mock.calls[0][0]).toMatchObject({
      name: 'Ana Maria',
      email: 'ana@ex.com',
      password: 'segredo123',
    })
  })

  it('criar conta: email em uso mostra erro claro (code real do fluxo)', async () => {
    const user = userEvent.setup()
    failWith(signUpEmail, 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL')
    renderForm('sign-up')

    await user.type(screen.getByLabelText('Nome'), 'Ana')
    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo123')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Este email já está cadastrado.')
  })

  it('criar conta: senha curta mostra erro claro (casa por code, não status)', async () => {
    const user = userEvent.setup()
    failWith(signUpEmail, 'PASSWORD_TOO_SHORT')
    renderForm('sign-up')

    await user.type(screen.getByLabelText('Nome'), 'Ana')
    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'curta')
    await user.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha precisa ter pelo menos 8 caracteres.',
    )
  })

  it('botão enviando desabilita durante a submissão', async () => {
    const user = userEvent.setup()
    // signIn.email pendura (promise não resolve) pra capturar o estado submitting.
    let release: (() => void) | undefined
    signInEmail.mockImplementation(
      () => new Promise<{ data: unknown; error: null }>((res) => { release = () => res({ data: {}, error: null }) }),
    )
    renderForm('sign-in')

    await user.type(screen.getByLabelText('Email'), 'ana@ex.com')
    await user.type(screen.getByLabelText('Senha'), 'segredo123')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    const btn = screen.getByRole('button', { name: 'Enviando…' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('aria-busy', 'true')
    release?.()
  })

  it('Google: aparece só quando googleEnabled e clicar chama signIn.social', async () => {
    const user = userEvent.setup()
    const { unmount } = renderForm('sign-in', false)
    expect(screen.queryByRole('button', { name: 'Continuar com o Google' })).not.toBeInTheDocument()
    unmount()

    renderForm('sign-in', true)
    const googleBtn = screen.getByRole('button', { name: 'Continuar com o Google' })
    await user.click(googleBtn)
    expect(signInSocial).toHaveBeenCalledTimes(1)
    expect(signInSocial.mock.calls[0][0]).toMatchObject({ provider: 'google' })
  })

  it('en-US: títulos e rótulos em inglês', () => {
    renderForm('sign-up', false, 'en-US')
    // h1 e botão de submit usam "Create account".
    expect(screen.getByRole('heading', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })
})
