/**
 * Tela CRIAR NOVA SENHA (#469). O Better Auth redireciona pra cá (rota GET `/api/auth/reset-password/:token`)
 * com `?token=` válido, ou `?error=INVALID_TOKEN` quando expirou/já foi usado. A page lê a query e passa só
 * o token (ou `null`) pro form client. NOINDEX e `no-referrer`: o token está na URL e não pode vazar no
 * Referer de nenhuma navegação a partir daqui.
 */
import type { Metadata } from 'next'
import { Container } from '@/components/container'
import { ResetPasswordForm } from '@/components/auth/reset-password-form'
import { loggedInPageMetadata } from '@/server/http/page-metadata'
import { parseResetToken } from '@/components/auth/auth-errors'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  return { ...(await loggedInPageMetadata(params, (m) => m.auth.novaSenhaTitulo)), referrer: 'no-referrer' }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[]; error?: string | string[] }>
}) {
  const valid = parseResetToken(await searchParams)
  return (
    <Container as="main" className="py-16">
      <div className="mx-auto w-full max-w-sm">
        <ResetPasswordForm token={valid} />
      </div>
    </Container>
  )
}
