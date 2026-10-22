'use client'
/**
 * Aviso "Sua conta foi excluída." (#595), montado no layout: a exclusão deixa o sinal no sessionStorage
 * (`account-deleted-signal.ts`) e recarrega a home; aqui o sinal é consumido UMA vez e o aviso fica até a
 * pessoa fechar. A leitura do storage roda num timer depois da montagem: o HTML do servidor e o 1º render do
 * cliente batem (sem erro de hidratação), e o `setState` fora do corpo do efeito mantém o lint limpo (mesmo
 * padrão do `GuidedTour`). A região `status` existe sempre, vazia quando não há aviso.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'
import { consumeAccountDeletedSignal } from './account-deleted-signal'

export function AccountDeletedNotice() {
  const { messages } = useLocale()
  const m = messages.seusDados
  const [show, setShow] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (consumeAccountDeletedSignal()) setShow(true)
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div role="status" aria-live="polite">
      {show && (
        <Container className="pt-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
            <p className="font-medium text-fg">{m.excluida}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setShow(false)}>
              {m.fechar}
            </Button>
          </div>
        </Container>
      )}
    </div>
  )
}
