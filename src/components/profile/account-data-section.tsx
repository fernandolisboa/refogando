'use client'
/**
 * Seção "Seus dados" do `/me/profile` (#595, LGPD Art. 18 II/V/VI): o titular baixa o export da conta
 * (`GET /api/me/export`, JSON) e exclui a conta (`DeleteAccountDialog` → `POST /api/me/erasure`) sem usar a
 * API na mão. Fecha com os links da Política e de "Seus direitos". Mesma forma da `RestricoesPerfilForm`:
 * Visitante não vê nada (o `ProfileForm` acima já mostra o convite de entrar).
 */
import Link from 'next/link'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { DeleteAccountDialog } from './delete-account-dialog'
import { useAccountExportDownload } from './use-account-export-download'

const LINK = 'font-medium text-brand-ink hover:underline'

export function AccountDataSection() {
  const { messages } = useLocale()
  const m = messages.seusDados
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const dl = useAccountExportDownload()

  if (!authed) return null

  const baixando = dl.status === 'downloading'

  return (
    <section aria-labelledby="seus-dados-titulo" className="flex max-w-xl flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 id="seus-dados-titulo" className="font-display text-xl font-semibold tracking-tight text-fg">
          {m.titulo}
        </h2>
        <p className="text-sm text-muted">{m.descricao}</p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={baixando}
          aria-busy={baixando}
          aria-describedby="seus-dados-baixar-dica"
          onClick={() => void dl.download()}
        >
          {baixando ? m.baixando : m.baixar}
        </Button>
        <p id="seus-dados-baixar-dica" className="text-xs text-muted">
          {m.baixarDica}
        </p>
        {/* Região viva sempre no DOM (anuncia o desfecho do download). */}
        <div aria-live="polite" className="text-sm">
          {dl.status === 'done' && <p className="font-medium text-fg">{m.baixado}</p>}
          {dl.status === 'error' && (
            <p role="alert" className="font-medium text-fg">
              {m.erroBaixar}
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-col items-start gap-2">
        <DeleteAccountDialog triggerDescribedBy="seus-dados-excluir-dica" />
        <p id="seus-dados-excluir-dica" className="text-xs text-muted">
          {m.excluirDica}
        </p>
      </div>

      <p className="text-sm text-muted">
        {m.saibaMais}{' '}
        <Link href="/privacidade" className={LINK}>
          {messages.privacidade.titulo}
        </Link>
        {' · '}
        <Link href="/seus-direitos" className={LINK}>
          {messages.seusDireitos.titulo}
        </Link>
      </p>
    </section>
  )
}
