/**
 * Tela CRIAR CONTA (issue #55) — Server Component. Idêntica em forma à sign-in, mode
 * "sign-up": provê o ÚNICO `<main>` via <Container as="main"> e lê `isGoogleConfigured()`
 * (server-only) → prop `googleEnabled`. O `<h1>` localizado vive no AuthForm (client).
 *
 * Cartão estreito via WRAPPER filho (`max-w-sm`), não empilhando max-width no nó do
 * Container — ver nota em sign-in/page.tsx.
 */
import { Container } from '@/components/container'
import { AuthForm } from '@/components/auth/auth-form'
import { isGoogleConfigured } from '@/server/auth/google'
import { safeInternalPath } from '@/domain/safe-redirect'
import { publicPageMetadata } from '@/server/http/page-metadata'

// #462: título fino ("Criar conta") — casa o <h1> do AuthForm. Página pública (sem noindex).
export function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  return publicPageMetadata(params, (m) => m.auth.criarConta)
}

// `?returnTo=` (#308): propagado pelo link entrar↔criar-conta; sanitizado na borda (anti open-redirect).
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo } = await searchParams
  return (
    <Container as="main" className="py-16">
      <div className="mx-auto w-full max-w-sm">
        <AuthForm mode="sign-up" googleEnabled={isGoogleConfigured()} returnTo={safeInternalPath(returnTo)} />
      </div>
    </Container>
  )
}
