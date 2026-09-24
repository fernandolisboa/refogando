import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const requestPasswordReset = vi.fn()
const resetPassword = vi.fn()
vi.mock('@/lib/auth-client', () => ({
  requestPasswordReset: (...a: unknown[]) => requestPasswordReset(...a),
  resetPassword: (...a: unknown[]) => resetPassword(...a),
}))

import { LocaleProvider } from '@/i18n/provider'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import type { Locale } from '@/i18n/locale'

function wrap(node: ReactNode, locale: Locale = 'pt-BR') {
  return render(<LocaleProvider initialLocale={locale}>{node}</LocaleProvider>)
}

beforeEach(() => {
  push.mockClear()
  requestPasswordReset.mockReset()
  resetPassword.mockReset()
})

describe('ForgotPasswordForm (#469)', () => {
  it('envia o email com redirectTo no locale atual e mostra a confirmação neutra', async () => {
    requestPasswordReset.mockResolvedValue({ data: { status: true }, error: null })
    wrap(<ForgotPasswordForm />, 'en-US')
    await userEvent.type(screen.getByLabelText('Email'), ' ana@x.test ')
    await userEvent.click(screen.getByRole('button', { name: 'Send link' }))
    expect(requestPasswordReset).toHaveBeenCalledWith({
      email: 'ana@x.test',
      redirectTo: '/en-US/reset-password',
    })
    expect(screen.getByRole('status')).toHaveTextContent(/If an account exists for this email/)
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('erro que não é limite/rede (ex.: 400) também cai na confirmação neutra — sem enumeração', async () => {
    requestPasswordReset.mockResolvedValue({ data: null, error: { status: 400, code: 'VALIDATION_ERROR' } })
    wrap(<ForgotPasswordForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(screen.getByRole('status')).toHaveTextContent(/Se houver uma conta com este email/)
  })

  it('429 mostra o aviso de muitas tentativas e mantém o formulário', async () => {
    requestPasswordReset.mockResolvedValue({ data: null, error: { status: 429 } })
    wrap(<ForgotPasswordForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'ana@x.test')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Muitas tentativas')
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('falha de rede (rejeição) mostra erro de conexão', async () => {
    requestPasswordReset.mockRejectedValue(new TypeError('offline'))
    wrap(<ForgotPasswordForm />)
    await userEvent.type(screen.getByLabelText('Email'), 'ana@x.test')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível conectar')
  })

  it('tem o link de volta pro Entrar', () => {
    wrap(<ForgotPasswordForm />)
    expect(screen.getByRole('link', { name: 'Voltar para entrar' })).toHaveAttribute('href', '/sign-in')
  })
})

describe('ResetPasswordForm (#469)', () => {
  it('sem token: não mostra o formulário, só o caminho pra pedir outro link', () => {
    wrap(<ResetPasswordForm token={null} />)
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('expirou ou já foi usado')
    expect(screen.getByRole('link', { name: 'Pedir novo link' })).toHaveAttribute('href', '/forgot-password')
  })

  it('senha curta é barrada no cliente, sem chamar o servidor', async () => {
    wrap(<ResetPasswordForm token="tok" />)
    await userEvent.type(screen.getByLabelText('Nova senha'), '1234567')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(resetPassword).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('pelo menos 8 caracteres')
  })

  it('sucesso: grava com o token e leva pro Entrar com a confirmação', async () => {
    resetPassword.mockResolvedValue({ data: { status: true }, error: null })
    wrap(<ResetPasswordForm token="tok" />)
    await userEvent.type(screen.getByLabelText('Nova senha'), 'senha-nova-123')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(resetPassword).toHaveBeenCalledWith({ newPassword: 'senha-nova-123', token: 'tok' })
    expect(push).toHaveBeenCalledWith('/sign-in?reset=1')
  })

  it('token recusado pelo servidor: troca o formulário pelo pedido de novo link', async () => {
    resetPassword.mockResolvedValue({ data: null, error: { status: 400, code: 'INVALID_TOKEN' } })
    wrap(<ResetPasswordForm token="velho" />)
    await userEvent.type(screen.getByLabelText('Nova senha'), 'senha-nova-123')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(push).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Nova senha')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Pedir novo link' })).toBeInTheDocument()
  })
})
