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
import { btnPrimary, btnSecondary } from '@/components/button'

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

export function AuthForm({ mode, googleEnabled }: { mode: Mode; googleEnabled: boolean }) {
  const { messages } = useLocale()
  const router = useRouter()
  const isSignUp = mode === 'sign-up'

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
          router.push('/')
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
        { provider: 'google' },
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
            <label htmlFor="auth-name" className="text-sm font-medium text-fg">
              {messages.auth.nome}
            </label>
            <input
              id="auth-name"
              name="name"
              type="text"
              autoComplete="name"
              autoFocus
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-email" className="text-sm font-medium text-fg">
            {messages.auth.email}
          </label>
          <input
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="auth-password" className="text-sm font-medium text-fg">
            {messages.auth.senha}
          </label>
          <input
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
            className="rounded-md border border-border bg-surface px-3 py-2 text-fg shadow-sm placeholder:text-muted"
          />
          {isSignUp && (
            <p id="auth-password-hint" className="text-sm text-muted">
              {messages.auth.senhaDica}
            </p>
          )}
        </div>

        {errorKey != null && (
          <p
            id="auth-error"
            role="alert"
            className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-medium text-fg"
          >
            {messages.auth[errorKey]}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className={`${btnPrimary} disabled:opacity-70`}
        >
          {submitting ? messages.auth.enviando : submitLabel}
        </button>
      </form>

      {googleEnabled && (
        <>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            <span>{messages.auth.ou}</span>
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
          <button type="button" onClick={onGoogle} className={btnSecondary}>
            {messages.auth.continuarComGoogle}
          </button>
        </>
      )}

      <p className="text-sm text-muted">
        {isSignUp ? messages.auth.jaTemConta : messages.auth.semConta}{' '}
        <Link
          href={isSignUp ? '/sign-in' : '/sign-up'}
          className="font-medium text-brand-ink hover:underline"
        >
          {isSignUp ? messages.nav.signIn : messages.auth.criarConta}
        </Link>
      </p>
    </div>
  )
}
