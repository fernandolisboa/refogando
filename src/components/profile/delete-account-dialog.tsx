'use client'
/**
 * "Excluir minha conta" (#595, LGPD Art. 18 VI): o gatilho + o diálogo de confirmação que chama
 * `POST /api/me/erasure`. Modal centrado da casa (`Sheet side="center"`, o Radix Dialog do ADR-0018, como o
 * `follow-list-modal`): `role=dialog`, trap de foco, Esc e o foco de volta ao gatilho vêm de graça. O foco
 * inicial vai para "Cancelar", a ação menos destrutiva.
 *
 * O diálogo diz o que é apagado e o que fica sem o nome da pessoa (`seusDados.apagadoItens`/`mantidoItens`,
 * o mesmo que o `eraseOwnAccount` faz), oferece baixar os dados antes, e só libera "Excluir definitivamente"
 * com a caixa "Entendo…" marcada. Enquanto exclui, nada fecha o diálogo: o `open` é controlado e o `guarded`
 * ignora o fechamento, e o X some.
 *
 * Saída depois de excluir: marca o sinal do aviso da home, esquece as abas lembradas (como o "Sair"),
 * chama o `signOut` com teto de 3s (o servidor já apagou as sessões; isto limpa o cookie e o atom, e o teto
 * impede um `signOut` offline de travar a tela) e recarrega a home do idioma com `location.assign`. Recarga
 * de verdade, não `router.push`: limpa todo estado privado em memória (as restrições salvas do
 * `RestricoesPerfilProvider`, notificações, o atom da sessão).
 *
 * Resposta perdida: a eliminação apaga as sessões na mesma transação, então repetir depois de uma resposta
 * que não chegou dá 401. Com o `respostaPerdida` marcado, esse 401 quer dizer "já excluída" e segue a saída
 * normal. Um 401 sem resposta perdida antes é sessão morta: mostra `erroSessao` e recarrega deslogado.
 * ADR-0010: route handler via fetch, nunca Server Action.
 */
import { useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { signOut } from '@/lib/auth-client'
import { forgetTabs } from '@/components/nav/last-tab-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { markAccountDeleted } from './account-deleted-signal'
import { useAccountExportDownload } from './use-account-export-download'

type Status = 'idle' | 'erasing' | 'leaving'
type Erro = null | 'falha' | 'sessao'

/** Teto do `signOut` na saída: a conta já foi excluída no servidor, a tela não espera a rede para sempre. */
const SIGN_OUT_TIMEOUT_MS = 3_000

async function signOutWithTimeout(): Promise<void> {
  await Promise.race([
    signOut().catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, SIGN_OUT_TIMEOUT_MS)),
  ])
}

export function DeleteAccountDialog({ triggerDescribedBy }: { triggerDescribedBy?: string }) {
  const { locale, messages } = useLocale()
  const m = messages.seusDados
  const [open, setOpen] = useState(false)
  const [entendo, setEntendo] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [erro, setErro] = useState<Erro>(null)
  // Uma tentativa anterior lançou no fetch: a eliminação pode ter acontecido sem a resposta chegar.
  const respostaPerdida = useRef(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  // Instância própria: o Radix põe `aria-hidden` fora do diálogo, então a região viva da seção não seria lida.
  const dl = useAccountExportDownload()

  const busy = status !== 'idle'
  // "Excluindo…" na chamada e na saída depois de excluir; na saída por sessão morta, o rótulo de sempre.
  const excluindo = status === 'erasing' || (status === 'leaving' && erro !== 'sessao')

  function guarded(next: boolean) {
    if (busy) return
    setOpen(next)
    if (!next) {
      setEntendo(false)
      setErro(null)
      dl.reset()
    }
  }

  async function sairDaContaExcluida() {
    setStatus('leaving')
    markAccountDeleted()
    forgetTabs()
    await signOutWithTimeout()
    window.location.assign(`/${locale}`)
  }

  async function sairDaSessaoMorta() {
    setStatus('leaving')
    setErro('sessao')
    forgetTabs()
    await signOutWithTimeout()
    window.location.reload()
  }

  async function excluir() {
    if (!entendo || busy) return
    setStatus('erasing')
    setErro(null)
    let res: Response
    try {
      res = await fetch('/api/me/erasure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
    } catch {
      respostaPerdida.current = true
      setStatus('idle')
      setErro('falha')
      return
    }
    if (res.ok) return sairDaContaExcluida()
    if (res.status === 401) return respostaPerdida.current ? sairDaContaExcluida() : sairDaSessaoMorta()
    setStatus('idle')
    setErro('falha')
  }

  return (
    <Sheet open={open} onOpenChange={guarded}>
      <SheetTrigger asChild>
        <Button type="button" variant="secondary" aria-describedby={triggerDescribedBy}>
          {m.excluir}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="center"
        closeLabel={m.fechar}
        showClose={!busy}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <SheetHeader>
          <SheetTitle>{m.dialogoTitulo}</SheetTitle>
          <SheetDescription>{m.dialogoDescricao}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{m.apagadoTitulo}</h3>
          <ul className="list-disc pl-5 text-sm text-fg">
            {m.apagadoItens.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-fg">{m.mantidoTitulo}</h3>
          <ul className="list-disc pl-5 text-sm text-fg">
            {m.mantidoItens.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">{m.baixarAntes}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={dl.status === 'downloading' || busy}
            aria-busy={dl.status === 'downloading'}
            onClick={() => void dl.download()}
          >
            {dl.status === 'downloading' ? m.baixando : m.baixar}
          </Button>
          <div aria-live="polite" className="text-sm">
            {dl.status === 'done' && <p className="font-medium text-fg">{m.baixado}</p>}
            {dl.status === 'error' && (
              <p role="alert" className="font-medium text-fg">
                {m.erroBaixar}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-start gap-2">
          <Checkbox
            id="excluir-conta-entendo"
            checked={entendo}
            onCheckedChange={(v) => setEntendo(v === true)}
            disabled={busy}
            className="mt-0.5"
          />
          <Label htmlFor="excluir-conta-entendo" className="font-normal leading-snug">
            {m.entendo}
          </Label>
        </div>

        {erro !== null && (
          <p role="alert" className="text-sm font-medium text-fg">
            {erro === 'sessao' ? m.erroSessao : m.erroExcluir}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={() => guarded(false)}>
            {m.cancelar}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!entendo || busy || dl.status === 'downloading'}
            aria-busy={excluindo}
            onClick={() => void excluir()}
          >
            {excluindo ? m.excluindo : m.confirmar}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
