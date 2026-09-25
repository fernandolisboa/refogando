'use client'
/**
 * Formulário compartilhado de autenticação (issue #55, ADR-0010). Corpo de entrar/criar
 * conta parametrizado por `mode` pra os dois fluxos não divergirem. Consome o cliente
 * Better Auth (`@/lib/auth-client`), que fala com o route handler `/api/auth/[...all]`
 * via fetch — NÃO Server Actions, NÃO regra de domínio reimplementada no front: renderiza
 * o que o cliente devolve.
 *
 * `googleEnabled` vem por PROP da page (Server Component), que é a FONTE ÚNICA da verdade
 * "Google ligado?" (server-only `hasGoogle`). Sem env público; o botão Google só aparece
 * quando o provider está de fato configurado, evitando um `signIn.social` contra um
 * provider dormente.
 *
 * Este componente client rende o ÚNICO `<h1>` do documento (localizado via useLocale);
 * a page (server) rende o ÚNICO `<main>` (via <Container as="main">). Um landmark, um h1.
 *
 * Erro: bloco neutro `role="alert"` (cor `text-fg`, NÃO o token `aviso` — reservado pro
 * Aviso de restrição, ADR-0004). Texto sempre traduzido por CHAVE via `mapAuthError`
 * (`auth-errors.ts`, casa `error.code` do Better Auth), nunca a mensagem crua do servidor.
 *
 * Confirmação de email (#470): criar conta NÃO loga — o sucesso troca o formulário pela tela "confira seu
 * email" (com reenvio), que é a MESMA exista ou não conta com o email (o servidor responde igual). Entrar com
 * conta não confirmada dá 403 EMAIL_NOT_VERIFIED: mensagem própria + reenvio. O link do e-mail loga e leva ao
 * `returnTo`.
 */
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { signIn, signUp } from '@/lib/auth-client'
import { safeInternalPath } from '@/domain/safe-redirect'
import { mapAuthError, type AuthError, type AuthErrorKey } from '@/components/auth/auth-errors'
import { ResendVerification } from '@/components/auth/resend-verification'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'sign-in' | 'sign-up'

/** Contexto de erro do cliente Better Auth (better-fetch); `status`/`code` vêm do intersect
 * `Record<string, any>`, então são lidos como campos dinâmicos. */
type AuthErrorCtx = { error: AuthError & Record<string, unknown> }

export function AuthForm({
  mode,
  googleEnabled,
  returnTo = '/',
  passwordReset = false,
  emailVerified = false,
}: {
  mode: Mode
  googleEnabled: boolean
  /** Caminho INTERNO pra onde voltar pós-login (#308). Default '/' (Busca/home). */
  returnTo?: string
  /** Chegou aqui logo após redefinir a senha (#469, `?reset=1`) — mostra a confirmação acima do form. */
  passwordReset?: boolean
  /** Chegou aqui por um link de confirmação já usado, sem sessão (#470, `?verified=1`) — confirma acima do form. */
  emailVerified?: boolean
}) {
  const { messages } = useLocale()
  const router = useRouter()
  const isSignUp = mode === 'sign-up'
  // Re-sanitiza por garantia (a page já passou pela guarda anti open-redirect). Email → push; Google →
  // callbackURL do OAuth. '/' preserva o comportamento anterior quando não há returnTo.
  const dest = safeInternalPath(returnTo)
  // O link entrar↔criar-conta PROPAGA o returnTo (senão o anônimo que clicou "Seguir" o perderia ao
  // trocar pra "Criar conta"). Sem returnTo, fica o href nu de antes.
  const toggleBase = isSignUp ? '/sign-in' : '/sign-up'
  const toggleHref = dest === '/' ? toggleBase : `${toggleBase}?returnTo=${encodeURIComponent(dest)}`

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null)
  // #470: email para o qual o cadastro "enviou" o link — non-null troca o formulário pela tela "confira seu email".
  const [sentTo, setSentTo] = useState<string | null>(null)

  const title = isSignUp ? messages.auth.criarConta : messages.nav.signIn
  const submitLabel = isSignUp ? messages.auth.criarConta : messages.nav.signIn

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrorKey(null)
    try {
      const onError = (ctx: AuthErrorCtx) => {
        setErrorKey(mapAuthError(ctx.error))
      }
      if (isSignUp) {
        // #470: sem sessão no cadastro. `callbackURL` = destino pós-confirmação (o link do e-mail).
        await signUp.email(
          { name, email, password, callbackURL: dest },
          { onSuccess: () => setSentTo(email.trim()), onError },
        )
      } else {
        // Navega só no onSuccess (depois do ciclo completo) — evita flash de "Entrar"
        // pós-login. refresh() revalida a sessão da chrome; push('/') leva pra Busca (home).
        await signIn.email(
          { email, password },
          {
            onSuccess: () => {
              router.refresh()
              router.push(dest)
            },
            onError,
          },
        )
      }
    } catch {
      // Rejeição sem ciclo onError (ex.: falha de rede antes do fetch).
      setErrorKey('erroRede')
    } finally {
      setSubmitting(false)
    }
  }

  async function onGoogle() {
    setErrorKey(null)
    try {
      await signIn.social(
        { provider: 'google', callbackURL: dest },
        {
          onError: (ctx: AuthErrorCtx) => {
            setErrorKey(mapAuthError(ctx.error))
          },
        },
      )
    } catch {
      // Rejeição sem ciclo onError (falha de transporte antes do fetch) — espelha onSubmit.
      setErrorKey('erroRede')
    }
  }

  if (sentTo != null) {
    const signInHref = dest === '/' ? '/sign-in' : `/sign-in?returnTo=${encodeURIComponent(dest)}`
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-display text-3xl font-semibold text-fg">{messages.auth.confirmeEmailTitulo}</h1>
        <Alert variant="info" role="status">
          <AlertDescription className="font-medium text-foreground">
            {messages.auth.confirmeEmailCorpo.replace('{email}', sentTo)}
          </AlertDescription>
        </Alert>
        <ResendVerification email={sentTo} callbackURL={dest} />
        <p className="text-sm text-muted">
          {messages.auth.confirmeEmailJaTemConta}{' '}
          <Link href={signInHref} className="font-medium text-brand-ink hover:underline">
            {messages.nav.signIn}
          </Link>
          {' · '}
          <Link href="/forgot-password" className="font-medium text-brand-ink hover:underline">
            {messages.auth.esqueciSenha}
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{title}</h1>

      {emailVerified && !isSignUp && (
        <Alert variant="info" role="status">
          <AlertDescription className="font-medium text-foreground">
            {messages.auth.emailConfirmado}
          </AlertDescription>
        </Alert>
      )}

      {passwordReset && !isSignUp && (
        <Alert variant="info" role="status">
          <AlertDescription className="font-medium text-foreground">
            {messages.auth.senhaRedefinida}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {isSignUp && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="auth-name">{messages.auth.nome}</Label>
            <Input
              id="auth-name"
              name="name"
              type="text"
              autoComplete="name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auth-email">{messages.auth.email}</Label>
          <Input
            id="auth-email"
            name="email"
            type="email"
            autoComplete="email"
            autoFocus={!isSignUp}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errorKey != null}
            aria-describedby={errorKey != null ? 'auth-error' : undefined}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="auth-password">{messages.auth.senha}</Label>
          <Input
            id="auth-password"
            name="password"
            type="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            required
            minLength={isSignUp ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={errorKey != null}
            aria-describedby={
              isSignUp ? 'auth-password-hint' : errorKey != null ? 'auth-error' : undefined
            }
          />
          {isSignUp && (
            <p id="auth-password-hint" className="text-sm text-muted">
              {messages.auth.senhaDica}
            </p>
          )}
          {!isSignUp && (
            <Link
              href="/forgot-password"
              className="self-end text-sm font-medium text-brand-ink hover:underline"
            >
              {messages.auth.esqueciSenha}
            </Link>
          )}
        </div>

        {errorKey != null && (
          <Alert variant="info" role="alert" id="auth-error">
            <AlertDescription className="font-medium text-foreground">
              {messages.auth[errorKey]}
            </AlertDescription>
          </Alert>
        )}

        {errorKey === 'erroEmailNaoVerificado' && <ResendVerification email={email} callbackURL={dest} />}

        <Button type="submit" disabled={submitting} aria-busy={submitting}>
          {submitting ? messages.auth.enviando : submitLabel}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span>{messages.auth.ou}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
          <Button type="button" variant="secondary" onClick={onGoogle}>
            {messages.auth.continuarComGoogle}
          </Button>
        </>
      )}

      <p className="text-sm text-muted">
        {isSignUp ? messages.auth.jaTemConta : messages.auth.semConta}{' '}
        <Link
          href={toggleHref}
          className="font-medium text-brand-ink hover:underline"
        >
          {isSignUp ? messages.nav.signIn : messages.auth.criarConta}
        </Link>
      </p>
    </div>
  )
}
