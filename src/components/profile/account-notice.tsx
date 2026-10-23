'use client'
/**
 * Aviso de conta depois da recarga (#595), montado no layout: a saída do diálogo de exclusão deixa o sinal
 * no sessionStorage (`account-notice-signal.ts`) e recarrega; aqui o sinal é consumido UMA vez e o aviso
 * fica até a pessoa fechar. "Sua conta foi excluída." na home, ou o `erroSessao` quando a sessão tinha
 * expirado (a mensagem do diálogo sumiria com a recarga). A leitura do storage roda num timer depois da
 * montagem: o HTML do servidor e o 1º render do cliente batem (sem erro de hidratação), e o `setState` fora
 * do corpo do efeito mantém o lint limpo (mesmo padrão do `GuidedTour`). A região `status` existe sempre,
 * vazia quando não há aviso.
 */
import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Container } from '@/components/container'
import { Button } from '@/components/ui/button'
import { consumeAccountNotice, type AccountNoticeKind } from './account-notice-signal'

export function AccountNotice() {
  const { messages } = useLocale()
  const m = messages.seusDados
  const [kind, setKind] = useState<AccountNoticeKind | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => {
      const next = consumeAccountNotice()
      if (next) setKind(next)
    }, 0)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div role="status" aria-live="polite">
      {kind && (
        <Container className="pt-4">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm">
            <p className="font-medium text-fg">{kind === 'excluida' ? m.excluida : m.erroSessao}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setKind(null)}>
              {m.fechar}
            </Button>
          </div>
        </Container>
      )}
    </div>
  )
}
