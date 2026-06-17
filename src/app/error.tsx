'use client'
/**
 * Estado global de erro (issue #54). Error boundaries do App Router DEVEM ser client
 * components e recebem { error, reset }. Renderiza messages.system.error com um botão de
 * "tentar de novo" (reset). Tom calmo e morno — coerente com a identidade não-alarmante
 * (o aviso de restrição também é âmbar, nunca vermelho-bloqueio: ADR-0004).
 */
import { useEffect } from 'react'
import { useLocale } from '@/i18n/provider'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { messages } = useLocale()
  useEffect(() => {
    // Observabilidade mínima; o digest liga ao log do servidor sem vazar detalhe pro usuário.
    console.error(error)
  }, [error])
  return (
    <main className="mx-auto flex max-w-page flex-col items-start gap-5 px-4 py-24 sm:px-6">
      <h1 className="font-display text-3xl font-semibold text-fg">{messages.system.error}</h1>
      <button
        type="button"
        onClick={reset}
        className="inline-flex items-center rounded-md bg-brand-strong px-4 py-2 text-sm font-medium text-on-brand shadow-sm transition-colors duration-150 ease-out hover:opacity-90"
      >
        {messages.system.retry}
      </button>
    </main>
  )
}
