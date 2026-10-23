'use client'
/**
 * Seção "Seus dados" do `/me/profile` (#595; LGPD Art. 18, II e V; eliminação: arts. 15, III e 16 (18, VI
 * para as restrições salvas)): o titular baixa o export da conta (`GET /api/me/export`, JSON) e exclui a
 * conta (`DeleteAccountDialog` → `POST /api/me/erasure`) sem usar a API na mão. Fecha com os links da
 * Política e de "Seus direitos". Mesma forma da `RestricoesPerfilForm`: Visitante não vê nada (o
 * `ProfileForm` acima já mostra o convite de entrar).
 *
 * O download é UM só (`useAccountExportDownload` aqui, passado ao diálogo): os dois botões mostram o mesmo
 * estado e a exclusão espera o download acabar.
 *
 * `pendente`: enquanto uma exclusão está em curso (o pedido, a checagem da sessão, a saída), a seção fica
 * montada mesmo que a sessão vire `null`. O Better Auth refaz o get-session ao voltar `online` (e o
 * `signOut` da saída zera o atom); sem isto o diálogo sumiria no meio do caminho.
 */
import Link from 'next/link'
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { DeleteAccountDialog } from './delete-account-dialog'
import { ExportDownloadControl } from './export-download-control'
import { useAccountExportDownload } from './use-account-export-download'

const LINK = 'font-medium text-brand-ink hover:underline'

export function AccountDataSection() {
  const { messages } = useLocale()
  const m = messages.seusDados
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data
  const dl = useAccountExportDownload()
  const [pendente, setPendente] = useState(false)

  if (!authed && !pendente) return null

  return (
    <section id="seus-dados" aria-labelledby="seus-dados-titulo" className="flex max-w-xl flex-col gap-4 border-t border-border pt-8">
      <div className="flex flex-col gap-1">
        <h2 id="seus-dados-titulo" className="font-display text-xl font-semibold tracking-tight text-fg">
          {m.titulo}
        </h2>
        <p className="text-sm text-muted">{m.descricao}</p>
      </div>

      <div className="flex flex-col items-start gap-2">
        <ExportDownloadControl dl={dl} hint={{ id: 'seus-dados-baixar-dica', text: m.baixarDica }} />
      </div>

      <div className="flex flex-col items-start gap-2">
        <DeleteAccountDialog
          triggerDescribedBy="seus-dados-excluir-dica"
          userId={session.data?.user.id}
          sessionCreatedAt={session.data?.session.createdAt}
          dl={dl}
          onPendingChange={setPendente}
        />
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
