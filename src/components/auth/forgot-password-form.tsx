'use client'
/**
 * Tela "esqueci minha senha" (#469) — pede o link de redefinição ao Better Auth
 * (`requestPasswordReset` → POST /api/auth/request-password-reset). O e-mail é enviado pelo
 * `sendResetPassword` do servidor (`src/lib/auth.ts`).
 *
 * Sem enumeração de contas: qualquer resposta que não seja erro de transporte/limite mostra a MESMA
 * confirmação neutra ("se houver uma conta…"), exista ou não o email. Só o 429 (limite 3/min por IP)
 * e a falha de rede têm mensagem própria — nenhuma das duas revela se a conta existe.
 *
 * `redirectTo` leva o locale atual: o link do e-mail volta pra `/{locale}/reset-password?token=…`.
 */
import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { requestPasswordReset } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ErrorKey = 'erroMuitasTentativas' | 'erroRede'

export function ForgotPasswordForm() {
  const { locale, messages } = useLocale()
  const m = messages.auth
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setErrorKey(null)
    try {
      const { error } = await requestPasswordReset({
        email: email.trim(),
        redirectTo: `/${locale}/reset-password`,
      })
      if (error?.status === 429) setErrorKey('erroMuitasTentativas')
      else if (error && !error.status) setErrorKey('erroRede')
      // Qualquer outro desfecho (sucesso, 400 de email malformado…) cai na confirmação neutra.
      else setDone(true)
    } catch {
      setErrorKey('erroRede')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{m.redefinirTitulo}</h1>

      {done ? (
        <Alert variant="info" role="status">
          <AlertDescription className="font-medium text-foreground">{m.linkEnviado}</AlertDescription>
        </Alert>
      ) : (
        <>
          <p className="text-sm text-muted">{m.redefinirDescricao}</p>
          <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="forgot-email">{m.email}</Label>
              <Input
                id="forgot-email"
                name="email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errorKey != null}
                aria-describedby={errorKey != null ? 'forgot-error' : undefined}
              />
            </div>

            {errorKey != null && (
              <Alert variant="info" role="alert" id="forgot-error">
                <AlertDescription className="font-medium text-foreground">{m[errorKey]}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" disabled={submitting || email.trim() === ''} aria-busy={submitting}>
              {submitting ? m.enviando : m.enviarLink}
            </Button>
          </form>
        </>
      )}

      <p className="text-sm text-muted">
        <Link href="/sign-in" className="font-medium text-brand-ink hover:underline">
          {m.voltarEntrar}
        </Link>
      </p>
    </div>
  )
}
