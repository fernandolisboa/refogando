/**
 * Tela ENTRAR (issue #55) — Server Component. Provê o ÚNICO `<main>` do documento via
 * <Container as="main"> e lê `isGoogleConfigured()` (server-only, FONTE ÚNICA da verdade
 * "Google ligado?"), passando-o como prop pro AuthForm (client). URL em inglês (CONTEXT.md).
 * O `<h1>` localizado vive dentro do AuthForm (client) — um único <main>, um único <h1>.
 *
 * O cartão estreito vem de um WRAPPER filho (`max-w-sm` em elemento interno), não de
 * empilhar `max-w-sm` sobre `max-w-page` no mesmo nó do Container — duas utilities de
 * max-width no mesmo elemento dependeriam da ordem de emissão no CSS (frágil no Tailwind v4).
 */
import { Container } from '@/components/container'
import { AuthForm } from '@/components/auth/auth-form'
import { isGoogleConfigured } from '@/server/auth/google'
import { safeInternalPath } from '@/domain/safe-redirect'

// `?returnTo=` (#308): pra onde voltar após o login (ex.: o anônimo que clicou "Seguir" na Descoberta de
// Cozinheiros). Sanitizado pela guarda anti open-redirect ANTES de chegar ao client (defesa na borda).
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo } = await searchParams
  return (
    <Container as="main" className="py-16">
      <div className="mx-auto w-full max-w-sm">
        <AuthForm mode="sign-in" googleEnabled={isGoogleConfigured()} returnTo={safeInternalPath(returnTo)} />
      </div>
    </Container>
  )
}
