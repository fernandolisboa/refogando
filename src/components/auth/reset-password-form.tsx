'use client'
/**
 * Tela "criar nova senha" (#469). O link do e-mail passa pela rota GET do Better Auth
 * (`/api/auth/reset-password/:token`), que valida o token e redireciona pra cá com `?token=…` — ou com
 * `?error=INVALID_TOKEN` se expirou/já foi usado. A page (server) lê a query e passa `token` por prop;
 * sem token válido esta tela nem mostra o formulário, só o caminho pra pedir um link novo.
 *
 * Sucesso ⇒ `/sign-in?reset=1` (a sessão NÃO é criada aqui; o Better Auth ainda derruba as sessões abertas,
 * `revokeSessionsOnPasswordReset`). Erros traduzidos por CHAVE, nunca a mensagem crua do servidor.
 */
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { resetPassword } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ErrorKey = 'erroLinkInvalido' | 'erroSenhaCurta' | 'erroMuitasTentativas' | 'erroRede' | 'erroGenerico'

/** Mínimo do Better Auth (default `minPasswordLength`), o mesmo do cadastro. */
const MIN_PASSWORD = 8

function mapErrorToKey(error: { status?: number; code?: string }): ErrorKey {
  if (!error.status) return 'erroRede'
  if (error.status === 429) return 'erroMuitasTentativas'
  if (error.code === 'INVALID_TOKEN') return 'erroLinkInvalido'
  if (error.code === 'PASSWORD_TOO_SHORT') return 'erroSenhaCurta'
  return 'erroGenerico'
}

export function ResetPasswordForm({ token }: { token: string | null }) {
  const { messages } = useLocale()
  const m = messages.auth
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(token ? null : 'erroLinkInvalido')

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!token) return
    if (password.length < MIN_PASSWORD) {
      setErrorKey('erroSenhaCurta')
      return
    }
    setSubmitting(true)
    setErrorKey(null)
    try {
      const { error } = await resetPassword({ newPassword: password, token })
      if (error) setErrorKey(mapErrorToKey(error))
      else router.push('/sign-in?reset=1')
    } catch {
      setErrorKey('erroRede')
    } finally {
      setSubmitting(false)
    }
  }

  const linkDead = !token || errorKey === 'erroLinkInvalido'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{m.novaSenhaTitulo}</h1>

      {!linkDead && (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reset-password">{m.novaSenha}</Label>
            <Input
              id="reset-password"
              name="password"
              type="password"
              autoComplete="new-password"
              autoFocus
              required
              minLength={MIN_PASSWORD}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={errorKey != null}
              aria-describedby={errorKey != null ? 'reset-error' : 'reset-password-hint'}
            />
            <p id="reset-password-hint" className="text-sm text-muted">
              {m.senhaDica}
            </p>
          </div>

          {errorKey != null && (
            <Alert variant="info" role="alert" id="reset-error">
              <AlertDescription className="font-medium text-foreground">{m[errorKey]}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={submitting} aria-busy={submitting}>
            {submitting ? m.enviando : m.salvarSenha}
          </Button>
        </form>
      )}

      {linkDead && (
        <>
          <Alert variant="info" role="alert">
            <AlertDescription className="font-medium text-foreground">{m.erroLinkInvalido}</AlertDescription>
          </Alert>
          <p className="text-sm">
            <Link href="/forgot-password" className="font-medium text-brand-ink hover:underline">
              {m.pedirNovoLink}
            </Link>
          </p>
        </>
      )}
    </div>
  )
}
