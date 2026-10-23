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
 * Confirmação de email (#470): com ela ligada no servidor (só quando o e-mail de conta está configurado), criar
 * conta NÃO loga — o sucesso sem `token` troca o formulário pela tela "confira seu email" (com reenvio), que é a
 * MESMA exista ou não conta com o email (o servidor responde igual). Com `token` (confirmação desligada), entra
 * direto como antes. Entrar com conta não confirmada dá o MESMO 401 de senha errada (sem oráculo) e não dispara
 * e-mail: com a confirmação ligada (`emailVerification`), o erro traz a dica neutra "acabou de criar a conta?" +
 * reenvio (que manda o link "conclua seu cadastro"). O link de confirmação do cadastro loga e leva ao `returnTo`.
 *
 * Aviso de idade e Termos (ADR-0051; #595 criou a linha): autodeclaração de 16 anos ou mais e links para os
 * Termos de Uso e a Política, sem caixa de marcar (a base da conta é o contrato, os Termos; o parecer §7
 * considerou a autodeclaração proporcional). No cadastro, fica logo acima do "Criar conta"; no "Entrar" com
 * Google ligado (o Google cria a conta no primeiro acesso), depois do botão do Google. Os dois botões que criam
 * conta apontam para a linha (`aria-describedby`): o leitor de tela a ouve no momento de aceitar.
 *
 * Por que criar conta (#472): no cadastro, três bullets (`auth.vantagens`) logo abaixo do título.
 */
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { localePrefixedPath } from '@/i18n/locale-path'
import { signIn, signUp } from '@/lib/auth-client'
import { holdSessionLossReload } from '@/components/session-loss-guard'
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
  emailVerification = false,
}: {
  mode: Mode
  googleEnabled: boolean
  /** Caminho INTERNO pra onde voltar pós-login (#308). Default '/' (Busca/home). */
  returnTo?: string
  /** Chegou aqui logo após redefinir a senha (#469, `?reset=1`) — mostra a confirmação acima do form. */
  passwordReset?: boolean
  /** Chegou aqui por um link de confirmação já usado, sem sessão (#470, `?verified=1`) — confirma acima do form. */
  emailVerified?: boolean
  /** A confirmação de email está ligada no servidor (#470) — o erro de login ganha a dica + reenvio. */
  emailVerification?: boolean
}) {
  const { locale, messages } = useLocale()
  const router = useRouter()
  const isSignUp = mode === 'sign-up'
  // Re-sanitiza por garantia (a page já passou pela guarda anti open-redirect). Email → push; Google →
  // callbackURL do OAuth. '/' preserva o comportamento anterior quando não há returnTo.
  const dest = safeInternalPath(returnTo)
  // #602: o `callbackURL` que vai ao Better Auth (Google, link de confirmação) sai SEM o `#…`: o originCheck dele
  // recusa um caminho com fragmento (403 INVALID_CALLBACK_URL), e o "entrar de novo para excluir a conta" volta a
  // `/me/profile#seus-dados`. Só a navegação do login por senha (`router.push(dest)`) leva o fragmento.
  const callbackDest = dest.split('#')[0] || '/'
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
  // `{termos}` e `{privacidade}` viram links (ADR-0051). Prefixados com o locale: é o aviso do contrato, e o texto
  // aceito tem de estar no idioma que a pessoa lê (sem o 302 do proxy, que decide por cookie/Accept-Language).
  const avisoPartes = messages.auth.privacidadeCadastro.split(/(\{termos\}|\{privacidade\})/)
  const submitLabel = isSignUp ? messages.auth.criarConta : messages.nav.signIn
  // A linha aparece em todo modo que cria conta: o cadastro e o Google (que cria no primeiro acesso).
  const mostraAviso = isSignUp || googleEnabled
  const aviso = mostraAviso && (
    <p id="auth-privacidade" className="text-sm text-muted">
      {avisoPartes.map((parte, i) =>
        parte === '{termos}' ? (
          <Link
            key={i}
            href={localePrefixedPath(locale, '/termos')}
            className="font-medium text-brand-ink hover:underline"
          >
            {messages.termos.nome}
          </Link>
        ) : parte === '{privacidade}' ? (
          <Link
            key={i}
            href={localePrefixedPath(locale, '/privacidade')}
            className="font-medium text-brand-ink hover:underline"
          >
            {messages.privacidade.titulo}
          </Link>
        ) : (
          <Fragment key={i}>{parte}</Fragment>
        ),
      )}
    </p>
  )

  // Entrar como OUTRA conta estando logado troca a sessão: o SessionLossGuard recarregaria a tela de login
  // por cima do `router.push(dest)`. Segura do envio até sair desta tela (desmontar) ou o pedido não navegar;
  // ao soltar, uma troca vista no meio recarrega o destino, limpando o estado da conta anterior.
  const releaseRef = useRef<(() => void) | null>(null)
  useEffect(
    () => () => {
      releaseRef.current?.()
      releaseRef.current = null
    },
    [],
  )

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrorKey(null)
    releaseRef.current?.()
    releaseRef.current = holdSessionLossReload()
    let navigating = false
    try {
      const onError = (ctx: AuthErrorCtx) => {
        setErrorKey(mapAuthError(ctx.error))
      }
      // Navega só no onSuccess (depois do ciclo completo) — evita flash de "Entrar"
      // pós-login. refresh() revalida a sessão da chrome; push('/') leva pra Busca (home).
      const enter = () => {
        navigating = true
        router.refresh()
        router.push(dest)
      }
      if (isSignUp) {
        // #470: com a confirmação de email ligada no servidor (e-mail de conta configurado), o cadastro NÃO
        // loga (`token: null`) → tela "confira seu email". Desligada, a resposta traz o token da sessão já
        // criada → entra direto, como antes. `callbackURL` = destino pós-confirmação (o link do e-mail).
        await signUp.email(
          { name, email, password, callbackURL: callbackDest },
          {
            onSuccess: (ctx: { data?: { token?: string | null } | null }) => {
              if (ctx.data?.token) enter()
              else setSentTo(email.trim())
            },
            onError,
          },
        )
      } else {
        await signIn.email({ email, password }, { onSuccess: enter, onError })
      }
    } catch {
      // Rejeição sem ciclo onError (ex.: falha de rede antes do fetch).
      setErrorKey('erroRede')
    } finally {
      setSubmitting(false)
      if (!navigating) {
        releaseRef.current?.()
        releaseRef.current = null
      }
    }
  }

  async function onGoogle() {
    setErrorKey(null)
    try {
      await signIn.social(
        { provider: 'google', callbackURL: callbackDest },
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
        <ResendVerification email={sentTo} callbackURL={callbackDest} />
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

      {isSignUp && (
        <ul className="flex flex-col gap-2 text-muted">
          {messages.auth.vantagens.map((vantagem) => (
            <li key={vantagem} className="flex gap-2.5">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-brand" />
              {vantagem}
            </li>
          ))}
        </ul>
      )}

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

        {errorKey === 'erroCredencialInvalida' && emailVerification && !isSignUp && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">{messages.auth.dicaConfirmarEmail}</p>
            <ResendVerification email={email} callbackURL={callbackDest} />
          </div>
        )}

        {/* Cadastro: a linha logo acima do botão que cria a conta (vale também para o Google, mais abaixo). */}
        {isSignUp && aviso}

        <Button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          aria-describedby={isSignUp ? 'auth-privacidade' : undefined}
        >
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
          <Button type="button" variant="secondary" onClick={onGoogle} aria-describedby="auth-privacidade">
            {messages.auth.continuarComGoogle}
          </Button>
        </>
      )}

      {/* Entrar com Google ligado: a linha depois do botão do Google (é ele que cria a conta). */}
      {!isSignUp && aviso}

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
