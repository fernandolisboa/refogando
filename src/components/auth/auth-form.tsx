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
 * Aviso de restrição, ADR-0004). Texto sempre traduzido por CHAVE via `mapErrorToKey`
 * (casa `error.code` do Better Auth), nunca a mensagem crua do servidor.
 */
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { signIn, signUp } from '@/lib/auth-client'
import { safeInternalPath } from '@/domain/safe-redirect'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Mode = 'sign-in' | 'sign-up'

/** Chaves de erro dentro de messages.auth que mapErrorToKey pode devolver. */
type ErrorKey =
  | 'erroCredencialInvalida'
  | 'erroEmailEmUso'
  | 'erroSenhaCurta'
  | 'erroRede'
  | 'erroGenerico'

/** Contexto de erro do cliente Better Auth (better-fetch); `error.code` vem do intersect
 * `Record<string, any>`, então é lido como campo dinâmico (string | undefined). */
type AuthErrorCtx = { error: { code?: string } & Record<string, unknown> }

/**
 * Traduz o erro do Better Auth para uma chave de messages.auth. Casa por `error.code`
 * (SCREAMING_SNAKE), NÃO por status (PASSWORD_TOO_SHORT é 400, USER_ALREADY_EXISTS_USE_
 * ANOTHER_EMAIL é 422 — o status não discrimina). Sem `code` (fetch rejeitou: rede) →
 * erroRede. Qualquer outro → erroGenerico. NUNCA expõe error.message cru.
 */
function mapErrorToKey(code: string | undefined): ErrorKey {
  if (!code) return 'erroRede'
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'erroCredencialInvalida'
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
    case 'USER_ALREADY_EXISTS':
      return 'erroEmailEmUso'
    case 'PASSWORD_TOO_SHORT':
      return 'erroSenhaCurta'
    default:
      return 'erroGenerico'
  }
}

export function AuthForm({
  mode,
  googleEnabled,
  returnTo = '/',
}: {
  mode: Mode
  googleEnabled: boolean
  /** Caminho INTERNO pra onde voltar pós-login (#308). Default '/' (Busca/home). */
  returnTo?: string
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
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  const title = isSignUp ? messages.auth.criarConta : messages.nav.signIn
  const submitLabel = isSignUp ? messages.auth.criarConta : messages.nav.signIn

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrorKey(null)
    try {
      // Navega só no onSuccess (depois do ciclo completo) — evita flash de "Entrar"
      // pós-login. refresh() revalida a sessão da chrome; push('/') leva pra Busca (home).
      const handlers = {
        onSuccess: () => {
          router.refresh()
          router.push(dest)
        },
        onError: (ctx: AuthErrorCtx) => {
          setErrorKey(mapErrorToKey(ctx.error.code))
        },
      }
      if (isSignUp) {
        await signUp.email({ name, email, password }, handlers)
      } else {
        await signIn.email({ email, password }, handlers)
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
            setErrorKey(mapErrorToKey(ctx.error.code))
          },
        },
      )
    } catch {
      // Rejeição sem ciclo onError (falha de transporte antes do fetch) — espelha onSubmit.
      setErrorKey('erroRede')
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{title}</h1>

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
        </div>

        {errorKey != null && (
          <Alert variant="info" role="alert" id="auth-error">
            <AlertDescription className="font-medium text-foreground">
              {messages.auth[errorKey]}
            </AlertDescription>
          </Alert>
        )}

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
