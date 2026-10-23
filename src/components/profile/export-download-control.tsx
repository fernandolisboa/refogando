'use client'
/**
 * "Baixar meus dados" + a região viva do desfecho (#595). Usado na seção "Seus dados" e dentro do diálogo de
 * exclusão, sempre com o MESMO `useAccountExportDownload` (criado na seção): um download começado num lugar
 * aparece no outro. Cada lugar tem a sua região viva porque o Radix põe `aria-hidden` fora do diálogo
 * aberto, e a da seção não seria lida. A região fica sempre no DOM, vazia sem desfecho.
 */
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import type { AccountExportDownload } from './use-account-export-download'

export function ExportDownloadControl({
  dl,
  size,
  disabled = false,
  hint,
}: {
  dl: AccountExportDownload
  size?: 'sm' | 'default'
  /** Além do download em andamento (no diálogo: enquanto exclui). */
  disabled?: boolean
  /** A dica embaixo do botão, que vira a descrição acessível dele. */
  hint?: { id: string; text: string }
}) {
  const m = useLocale().messages.seusDados
  const baixando = dl.status === 'downloading'
  const erro = dl.status === 'sessao' ? m.erroBaixarSessao : dl.status === 'error' ? m.erroBaixar : null

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size={size}
        disabled={baixando || disabled}
        aria-busy={baixando}
        aria-describedby={hint?.id}
        onClick={() => void dl.download()}
      >
        {baixando ? m.baixando : m.baixar}
      </Button>
      {hint && (
        <p id={hint.id} className="text-xs text-muted">
          {hint.text}
        </p>
      )}
      <div aria-live="polite" className="text-sm">
        {dl.status === 'done' && <p className="font-medium text-fg">{m.baixado}</p>}
        {erro && (
          <p role="alert" className="font-medium text-fg">
            {erro}
          </p>
        )}
      </div>
    </>
  )
}
