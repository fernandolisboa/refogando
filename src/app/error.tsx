'use client'
/**
 * Estado global de erro (issue #54). Error boundaries do App Router DEVEM ser client
 * components e recebem { error, reset }. Renderiza messages.system.error com um botão de
 * "tentar de novo" (reset). Tom calmo e morno — coerente com a identidade não-alarmante
 * (o aviso de restrição também é âmbar, nunca vermelho-bloqueio: ADR-0004). Nome
 * `GlobalError` pra não sombrear o `Error` global (App Router só exige o default export).
 */
import { useEffect } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { btnPrimary } from '@/components/button'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { messages } = useLocale()
  useEffect(() => {
    // Observabilidade mínima; o digest liga ao log do servidor sem vazar detalhe pro usuário.
    console.error(error)
  }, [error])
  return (
    <Container as="main" className="flex flex-col items-start gap-5 py-24">
      <h1 className="font-display text-3xl font-semibold text-fg">{messages.system.error}</h1>
      <button type="button" onClick={reset} className={btnPrimary}>
        {messages.system.retry}
      </button>
    </Container>
  )
}
