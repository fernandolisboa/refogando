'use client'
/**
 * Botão "Reenviar email" do link de confirmação (#470) — usado na tela "confira seu email" pós-cadastro, no
 * erro de login de conta não confirmada e na tela de link inválido. Chama `sendVerificationEmail`
 * (POST /api/auth/send-verification-email); o e-mail sai do `sendVerificationEmail` do servidor.
 *
 * Sem enumeração: sem sessão, o servidor responde IGUAL exista ou não a conta (ou já esteja confirmada), então
 * sucesso e 400 de validação (email malformado) mostram a MESMA confirmação neutra ("se houver uma conta não
 * confirmada…" — o teto por conta também pode ter segurado o envio). Têm mensagem própria só o que não depende
 * da conta: 429 (limite 3/min por IP), rede, e 403/5xx (pedido recusado — dizer "enviamos" seria falso). COM
 * sessão (#470 B5) a lib recusa com 400 `EMAIL_ALREADY_VERIFIED` (a própria conta já confirmada) ou
 * `EMAIL_MISMATCH` (email de outra conta): falam da conta de quem está logado, então têm copy própria.
 *
 * `callbackURL` = pra onde o Usuário vai depois de confirmar (caminho interno; o servidor o faz passar pela
 * tela `/verify-email` e pela guarda anti open-redirect).
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { sendVerificationEmail } from '@/lib/auth-client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

type ErrorKey = 'erroMuitasTentativas' | 'erroRede' | 'erroGenerico' | 'erroOutraConta'
type DoneKey = 'confirmacaoReenviada' | 'emailJaConfirmado'

export function ResendVerification({ email, callbackURL = '/' }: { email: string; callbackURL?: string }) {
  const { messages } = useLocale()
  const m = messages.auth
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<DoneKey | null>(null)
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null)

  async function onResend() {
    setSending(true)
    setDone(null)
    setErrorKey(null)
    try {
      const { error } = await sendVerificationEmail({ email: email.trim(), callbackURL })
      const code = (error as { code?: string } | null)?.code
      if (error?.status === 429) setErrorKey('erroMuitasTentativas')
      else if (error && !error.status) setErrorKey('erroRede')
      else if (error && (error.status === 403 || error.status >= 500)) setErrorKey('erroGenerico')
      else if (code === 'EMAIL_ALREADY_VERIFIED') setDone('emailJaConfirmado')
      else if (code === 'EMAIL_MISMATCH') setErrorKey('erroOutraConta')
      else setDone('confirmacaoReenviada')
    } catch {
      setErrorKey('erroRede')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="secondary"
        onClick={onResend}
        disabled={sending || email.trim() === ''}
        aria-busy={sending}
      >
        {sending ? m.enviando : m.reenviarEmail}
      </Button>
      {done != null && (
        <Alert variant="info" role="status">
          <AlertDescription className="font-medium text-foreground">{m[done]}</AlertDescription>
        </Alert>
      )}
      {errorKey != null && (
        <Alert variant="info" role="alert">
          <AlertDescription className="font-medium text-foreground">{m[errorKey]}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
