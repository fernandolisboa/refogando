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
import { Button } from '@/components/ui/button'
import { isChunkLoadError, reloadForAppUpdate } from '@/lib/app-update-reload'

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
    // Atualização graceful (A2), ADR-0028 dec 5: um chunk de ROTA velho pós-deploy é jogado em
    // RENDER durante uma navegação client-side e cai AQUI (não no `window`). A pessoa já estava
    // trocando de tela ⇒ um reload quieto e one-shot é seguro ("fronteira de navegação"; a
    // persistência de rascunho é a rede de segurança real do trabalho). Erro NÃO-chunk mantém a
    // tela calma de "tentar de novo" (reset) abaixo. Se o reload voltar a bater no mesmo chunk
    // morto dentro da janela, `reloadForAppUpdate` pula → cai na UI normal (sem loop). Não
    // chamamos `reset()` no chunk error: só re-jogaria contra o chunk morto.
    if (isChunkLoadError(error, error.message)) reloadForAppUpdate()
  }, [error])
  return (
    <Container as="main" className="flex flex-col items-start gap-5 py-24">
      <h1 className="font-display text-3xl font-semibold text-fg">{messages.system.error}</h1>
      <Button type="button" onClick={reset}>
        {messages.system.retry}
      </Button>
    </Container>
  )
}
