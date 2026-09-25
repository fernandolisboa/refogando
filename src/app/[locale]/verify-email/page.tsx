/**
 * Chegada do link de CONFIRMAÇÃO DE EMAIL (#470) — Server Component. O link do e-mail vai primeiro ao Better
 * Auth (`/api/auth/verify-email`), que confirma a conta, cria a sessão (`autoSignInAfterVerification`) e
 * redireciona pra cá com `?returnTo=<destino>`; se o token não vale, com `&error=<CODE>`.
 *
 *  - sem `error` e com sessão → segue pro destino (guarda anti open-redirect), já logado;
 *  - sem `error` e SEM sessão (link reaberto depois de confirmado: o Better Auth não loga de novo) → Entrar,
 *    com a confirmação "email confirmado";
 *  - com `error` → tela de link inválido com reenvio (VerifyEmailRetry, client).
 *
 * NOINDEX: tela de fluxo de conta. Único `<main>` aqui; o `<h1>` vive no componente client.
 */
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Container } from '@/components/container'
import { VerifyEmailRetry } from '@/components/auth/verify-email-retry'
import { getAuth } from '@/lib/auth'
import { safeInternalPath } from '@/domain/safe-redirect'
import { canonicalLocale, DEFAULT_LOCALE } from '@/i18n/locale'
import { loggedInPageMetadata } from '@/server/http/page-metadata'

export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return loggedInPageMetadata(params, (m) => m.auth.verificarErroTitulo)
}

export default async function VerifyEmailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ returnTo?: string | string[]; error?: string | string[] }>
}) {
  const [{ locale }, { returnTo, error }] = await Promise.all([params, searchParams])
  const dest = safeInternalPath(typeof returnTo === 'string' ? returnTo : null)

  if (error === undefined) {
    const session = await getAuth().api.getSession({ headers: await headers() })
    if (session) redirect(dest)
    const back = dest === '/' ? '' : `&returnTo=${encodeURIComponent(dest)}`
    redirect(`/${canonicalLocale(locale) ?? DEFAULT_LOCALE}/sign-in?verified=1${back}`)
  }

  return (
    <Container as="main" className="py-16">
      <div className="mx-auto w-full max-w-sm">
        <VerifyEmailRetry returnTo={dest} />
      </div>
    </Container>
  )
}
