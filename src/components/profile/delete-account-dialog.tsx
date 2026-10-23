'use client'
/**
 * "Excluir minha conta" (#595; eliminação: LGPD arts. 15, III e 16 (18, VI para as restrições salvas)): o
 * gatilho + o diálogo de confirmação que chama `POST /api/me/erasure`. Modal centrado da casa
 * (`Sheet side="center"`, o Radix Dialog do ADR-0018, como o `follow-list-modal`): `role=dialog`, trap de
 * foco, Esc e o foco de volta ao gatilho vêm de graça. O foco inicial vai para "Cancelar", a ação menos
 * destrutiva.
 *
 * O diálogo diz o que é apagado e o que fica sem o nome da pessoa (`seusDados.apagadoItens`/`mantidoItens`,
 * o mesmo que o `eraseOwnAccount` faz), aponta "Minhas receitas" para quem quer apagar uma receita
 * publicada antes (só texto enquanto exclui), oferece baixar os dados (o MESMO download da seção, `dl`) e só libera "Excluir
 * definitivamente" com a caixa "Entendo…" marcada e nenhum download em andamento. Enquanto exclui, nada
 * fecha o diálogo: o `open` é controlado e o `guarded` ignora o fechamento, e o X some. `onPendingChange`
 * avisa a seção, que fica montada mesmo se a sessão virar `null` no meio (ver `AccountDataSection`).
 *
 * Desfechos do pedido:
 *  - 2xx: saída da conta excluída (abaixo).
 *  - 403 `reautenticar` (#602): a sessão tem mais de 24 h. Nada foi apagado; o diálogo pede para entrar de novo
 *    (link para o login, que volta a "Seus dados"), trava "Excluir definitivamente" e leva o foco ao aviso. O
 *    mesmo aviso aparece já ao abrir o diálogo quando a data de criação da sessão (`sessionCreatedAt`) parece
 *    antiga pelo relógio do aparelho (mesma regra, `isFreshSession`), mas aí o botão segue livre: um relógio
 *    adiantado não pode travar a exclusão, e quem decide é o servidor.
 *  - 401: a sessão já tinha morrido; mostra `erroSessao`, deixa o mesmo aviso para depois da recarga e
 *    recarrega a página deslogada.
 *  - Ambíguo (o `fetch` lança, ou 5xx: um 504 pode ter vindo depois do commit): pergunta ao
 *    `GET /api/auth/get-session`, sem cache e com teto de 8s. A eliminação apaga as sessões na mesma
 *    transação, e a sessão estava viva segundos antes; sessão `null` ⇒ a conta foi excluída, saída normal.
 *    Sessão viva, ou sem resposta ⇒ `erroExcluir`.
 *  - Outro 4xx: `erroExcluir`.
 * Na falha, o foco vai para "Excluir definitivamente" (ou para o alerta, se o botão estiver desabilitado),
 * para não cair no `body`.
 *
 * Saída depois de excluir: deixa o sinal do aviso da home, esquece as abas lembradas (como o "Sair"), o
 * estado do tour desta conta (`tourStorageKey`: o id é o mesmo da conta anonimizada) e o "Entendi" do aviso
 * dos Termos e da Política (`avisoLegalStorageKey`, ADR-0051), chama o `signOut`
 * com teto de 3s (o servidor já apagou as sessões; isto limpa o cookie e o atom, e o teto impede um
 * `signOut` offline de travar a tela) e recarrega a home do idioma com `location.assign`. Recarga de
 * verdade, não `router.push`: limpa todo estado privado em memória (as restrições salvas do
 * `RestricoesPerfilProvider`, notificações, o atom da sessão). O pedido inteiro roda sob
 * `holdSessionLossReload()`: sem ele o `SessionLossGuard` recarregaria a página atual ao ver a sessão
 * sumir (no `signOut` ou num refetch no meio do pedido) e a saída perderia o destino e o aviso.
 * ADR-0010: route handler via fetch, nunca Server Action.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { errorCode } from '@/lib/http-error'
import { signOut } from '@/lib/auth-client'
import { tourStorageKey } from '@/domain/onboarding-tour'
import { avisoLegalStorageKey } from '@/domain/legal-notice'
import { isFreshSession } from '@/domain/fresh-session'
import { forgetTabs } from '@/components/nav/last-tab-store'
import { holdSessionLossReload } from '@/components/session-loss-guard'
import { sectionLabel } from '@/components/nav/nav-labels'
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
import { markAccountNotice } from './account-notice-signal'
import { ExportDownloadControl } from './export-download-control'
import type { AccountExportDownload } from './use-account-export-download'

type Status = 'idle' | 'erasing' | 'leaving'
type Erro = null | 'falha' | 'sessao' | 'reautenticar'

/** Teto do `signOut` na saída: a conta já foi excluída no servidor, a tela não espera a rede para sempre. */
const SIGN_OUT_TIMEOUT_MS = 3_000

/** Teto do get-session depois de um desfecho ambíguo: sem resposta, vale "não deu para saber". */
const SESSION_CHECK_TIMEOUT_MS = 8_000

/** A aba "Criações" de "Minhas receitas" (`domain/nav-sections`): onde a pessoa apaga uma receita sua. */
const MINHAS_RECEITAS_HREF = '/me/recipes'

/** Entrar de novo (#602) e voltar à seção "Seus dados" do perfil (`id` da seção em `AccountDataSection`). */
const REAUTENTICAR_HREF = `/sign-in?returnTo=${encodeURIComponent('/me/profile#seus-dados')}`

const LINK = 'font-medium text-brand-ink hover:underline'

async function signOutWithTimeout(): Promise<void> {
  await Promise.race([
    signOut().catch(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, SIGN_OUT_TIMEOUT_MS)),
  ])
}

/**
 * Depois de um desfecho ambíguo: a sessão ainda existe? `false` = `null` do get-session (a eliminação a
 * apagou); `true` = sessão viva; `null` = não deu para saber (rede fora, resposta fora da forma, ou nada em
 * 8s: o `AbortSignal.timeout` corta o pedido e a leitura do corpo, e a tela não fica em "Excluindo…").
 */
async function sessaoViva(): Promise<boolean | null> {
  try {
    const res = await fetch('/api/auth/get-session', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (body === null) return false
    return typeof body === 'object' && (body as { session?: unknown }).session != null ? true : null
  } catch {
    return null
  }
}

export function DeleteAccountDialog({
  triggerDescribedBy,
  userId,
  sessionCreatedAt,
  dl,
  onPendingChange,
}: {
  triggerDescribedBy?: string
  /** O dono da sessão, para apagar o estado do tour dele na saída. */
  userId: string | undefined
  /** Quando a sessão foi criada: antiga (#602) ⇒ o diálogo já abre pedindo para entrar de novo. */
  sessionCreatedAt?: Date | string | null
  dl: AccountExportDownload
  onPendingChange: (pending: boolean) => void
}) {
  const { locale, messages } = useLocale()
  const m = messages.seusDados
  const [open, setOpen] = useState(false)
  const [entendo, setEntendo] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [erro, setErro] = useState<Erro>(null)
  // #602: aviso de sessão antiga dado já ao abrir (pelo relógio do aparelho); não trava nada.
  const [avisoSessaoAntiga, setAvisoSessaoAntiga] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  const busy = status !== 'idle'
  const baixando = dl.status === 'downloading'
  // "Excluindo…" na chamada e na saída depois de excluir; na saída por sessão morta, o rótulo de sempre.
  const excluindo = status === 'erasing' || (status === 'leaving' && erro !== 'sessao')
  const [publicadasAntes = '', publicadasDepois = ''] = m.apagarPublicadas.split('{link}')

  // A falha devolve o foco à ação (o botão ficou desabilitado durante o pedido e o foco cairia no `body`). O 403
  // `reautenticar` deixa o botão travado: o foco vai ao aviso, onde está o link para entrar de novo.
  useEffect(() => {
    if (erro === 'reautenticar') {
      alertRef.current?.focus()
      return
    }
    if (erro !== 'falha') return
    const confirmar = confirmRef.current
    if (confirmar && !confirmar.disabled) confirmar.focus()
    else alertRef.current?.focus()
  }, [erro])

  function guarded(next: boolean) {
    if (busy) return
    setOpen(next)
    if (next) setAvisoSessaoAntiga(sessionCreatedAt != null && !isFreshSession(sessionCreatedAt))
    if (!next) {
      setEntendo(false)
      setErro(null)
      setAvisoSessaoAntiga(false)
      dl.reset()
    }
  }

  async function sairDaContaExcluida(uid: string | undefined) {
    setStatus('leaving')
    markAccountNotice('excluida')
    forgetTabs()
    if (uid) {
      try {
        window.localStorage.removeItem(tourStorageKey(uid))
        window.localStorage.removeItem(avisoLegalStorageKey(uid))
      } catch {
        // Storage bloqueado: sobram só as marcas do tour e do aviso, sem dado pessoal.
      }
    }
    await signOutWithTimeout()
    window.location.assign(`/${locale}`)
  }

  async function sairDaSessaoMorta() {
    setStatus('leaving')
    setErro('sessao')
    markAccountNotice('sessao')
    forgetTabs()
    await signOutWithTimeout()
    window.location.reload()
  }

  async function excluir() {
    if (!entendo || busy || baixando || erro === 'reautenticar') return
    // O `userId` deste render: a sessão pode virar `null` no meio do pedido.
    const uid = userId
    // Segura a recarga do SessionLossGuard: quem sai daqui navega por conta própria. Solta ao desistir.
    const release = holdSessionLossReload()
    onPendingChange(true)
    setStatus('erasing')
    setErro(null)
    let res: Response | null
    try {
      res = await fetch('/api/me/erasure', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
    } catch {
      res = null
    }
    if (res?.ok) return sairDaContaExcluida(uid)
    if (res?.status === 401) return sairDaSessaoMorta()
    if (res?.status === 403 && (await errorCode(res)) === 'reautenticar') {
      setStatus('idle')
      setErro('reautenticar')
      onPendingChange(false)
      release()
      return
    }
    const ambiguo = res === null || res.status >= 500
    if (ambiguo && (await sessaoViva()) === false) return sairDaContaExcluida(uid)
    setStatus('idle')
    setErro('falha')
    onPendingChange(false)
    release()
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

        {/* Enquanto exclui, o rótulo vira texto: seguir o link desmontaria a página no meio da saída. */}
        <p className="text-sm text-muted">
          {publicadasAntes}
          {busy ? (
            <span className="font-medium text-fg">{sectionLabel(messages, 'minhasReceitas')}</span>
          ) : (
            <Link href={MINHAS_RECEITAS_HREF} className={LINK}>
              {sectionLabel(messages, 'minhasReceitas')}
            </Link>
          )}
          {publicadasDepois}
        </p>

        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-muted">{m.baixarAntes}</p>
          <ExportDownloadControl dl={dl} size="sm" disabled={busy} />
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

        {erro === 'reautenticar' || avisoSessaoAntiga ? (
          <p
            ref={erro === 'reautenticar' ? alertRef : undefined}
            role={erro === 'reautenticar' ? 'alert' : 'status'}
            tabIndex={-1}
            className="text-sm font-medium text-fg"
          >
            {m.reautenticar}{' '}
            <Link href={REAUTENTICAR_HREF} className={LINK}>
              {m.reautenticarLink}
            </Link>
          </p>
        ) : null}
        {erro !== null && erro !== 'reautenticar' && (
          <p ref={alertRef} role="alert" tabIndex={-1} className="text-sm font-medium text-fg">
            {erro === 'sessao' ? m.erroSessao : m.erroExcluir}
          </p>
        )}

        <div className="flex flex-wrap justify-end gap-3">
          <Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={() => guarded(false)}>
            {m.cancelar}
          </Button>
          <Button
            ref={confirmRef}
            type="button"
            variant="destructive"
            disabled={!entendo || busy || baixando || erro === 'reautenticar'}
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
