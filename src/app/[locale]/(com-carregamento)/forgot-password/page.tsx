/**
 * Tela ESQUECI MINHA SENHA (#469) — Server Component fino: provê o único `<main>`; o `<h1>` e o
 * formulário vivem no ForgotPasswordForm (client). Mesmo cartão estreito do Entrar. NOINDEX: tela de
 * fluxo de conta, sem valor de busca.
 */
import { Container } from '@/components/container'
import { ForgotPasswordForm } from '@/components/auth/forgot-password-form'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.auth.redefinirTitulo)
}

export default function ForgotPasswordPage() {
  return (
    <Container as="main" className="py-16">
      <div className="mx-auto w-full max-w-sm">
        <ForgotPasswordForm />
      </div>
    </Container>
  )
}
