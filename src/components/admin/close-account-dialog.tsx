'use client'
/**
 * "Eliminar conta" na gaveta do Console → Usuários (#606, ADR-0051 P1 e P3): o gatilho + o diálogo que chama
 * `POST /api/admin/users/[id]/erasure`. Modal centrado da casa (`Sheet side="center"`, o Radix Dialog do ADR-0018,
 * como o `DeleteAccountDialog` do perfil): trap de foco, Esc e o foco de volta ao gatilho vêm de graça; o foco
 * inicial vai para "Cancelar", a ação menos destrutiva.
 *
 * O diálogo pede o MOTIVO (menos de 16 anos | violação grave), lembra o passo humano que vem antes do botão (o aviso
 * por e-mail e o prazo de cada procedimento), avisa no menor de 16 que as receitas públicas e as avaliações saem junto
 * (sem opção: os Termos prometem eliminar "o que ela publicou", e o servidor faz isso sempre), oferece "avisar por
 * e-mail" só na violação (marcado; desmarcar só com impedimento legal) e pede o @ da conta digitado. "Eliminar definitivamente"
 * só libera com o motivo escolhido e o @ conferindo (`confirmsHandle`, a mesma regra do servidor).
 *
 * Enquanto elimina, nada fecha: o `open` é controlado e o `guarded` ignora o fechamento, o X some, e o
 * `onPendingChange` avisa a gaveta (que também não fecha). 403 `reautenticar`: a sessão do admin tem mais de 24 h;
 * nada foi apagado, o diálogo pede para entrar de novo (volta ao Console → Usuários) e leva o foco ao aviso. Outro
 * erro: a mensagem do código (`ERRO`), e o foco no alerta. Sucesso: fecha sem devolver o foco ao gatilho (ele some com
 * a conta inativa) e entrega o resultado à gaveta, que leva o foco ao desfecho e recarrega a lista. ADR-0010: route handler via fetch, nunca Server Action.
 */
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { errorCode } from '@/lib/http-error'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  ACCOUNT_CLOSURE_REASONS,
  canRemovePublicContent,
  closureEmailApplies,
  confirmsHandle,
  type AccountClosureReason,
} from '@/domain/account-closure'

/** Entrar de novo e voltar ao Console → Usuários. */
const REAUTENTICAR_HREF = `/sign-in?returnTo=${encodeURIComponent('/admin/users')}`

const LINK = 'font-medium text-brand-ink hover:underline'

const REASON_LABEL = {
  menor_16: 'usuariosEliminarMotivoMenor',
  violacao_grave: 'usuariosEliminarMotivoViolacao',
} as const satisfies Record<AccountClosureReason, string>

const REASON_HELP = {
  menor_16: 'usuariosEliminarMotivoMenorAjuda',
  violacao_grave: 'usuariosEliminarMotivoViolacaoAjuda',
} as const satisfies Record<AccountClosureReason, string>

/** Código de erro da rota → mensagem. O que não está aqui cai no genérico. */
const ERRO = {
  conta_inativa: 'usuariosEliminarErroInativa',
  confirmacao_invalida: 'usuariosEliminarErroConfirmacao',
  not_found: 'usuariosEliminarErroNaoEncontrada',
  conta_propria: 'usuariosEliminarTravaPropria',
  alvo_admin: 'usuariosEliminarTravaAdmin',
} as const

type Erro = keyof typeof ERRO | 'reautenticar' | 'falha'

export type CloseAccountOutcome = {
  removedPublicContent: boolean
  /** O aviso por e-mail foi pedido (violação com "avisar" marcado). */
  notifyRequested: boolean
  emailSent: boolean
}

export function CloseAccountDialog({
  user,
  disabled,
  triggerDescribedBy,
  onPendingChange,
  onClosed,
}: {
  user: { id: string; name: string; handle: string }
  disabled: boolean
  triggerDescribedBy?: string
  onPendingChange: (pending: boolean) => void
  onClosed: (outcome: CloseAccountOutcome) => void
}) {
  const { messages } = useLocale()
  const m = messages.admin
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<AccountClosureReason | null>(null)
  // Sucesso: o fechamento não devolve o foco ao gatilho (some junto com a seção); a gaveta foca o desfecho.
  const succeededRef = useRef(false)
  const [notify, setNotify] = useState(true)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<Erro | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const alertRef = useRef<HTMLParagraphElement>(null)

  const handleOk = confirmsHandle(typed, user.handle)
  const canSubmit = reason != null && handleOk && !busy && erro !== 'reautenticar'

  // Erro ⇒ o foco vai ao alerta (o botão ficou desabilitado durante o pedido e o foco cairia no `body`).
  useEffect(() => {
    if (erro) alertRef.current?.focus()
  }, [erro])

  function reset() {
    setReason(null)
    setNotify(true)
    setTyped('')
    setErro(null)
  }

  function guarded(next: boolean) {
    if (busy) return
    setOpen(next)
    if (!next) reset()
  }

  async function eliminar(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit || reason == null) return
    const removePublicContent = canRemovePublicContent(reason)
    const notifyRequested = closureEmailApplies(reason) && notify
    setBusy(true)
    onPendingChange(true)
    setErro(null)
    let res: Response | null
    try {
      res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/erasure`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason, removePublicContent, notify: notifyRequested, confirmHandle: typed }),
      })
    } catch {
      res = null
    }
    if (res?.ok) {
      const body = (await res.json().catch(() => null)) as { emailSent?: unknown } | null
      setBusy(false)
      onPendingChange(false)
      succeededRef.current = true
      setOpen(false)
      reset()
      onClosed({ removedPublicContent: removePublicContent, notifyRequested, emailSent: body?.emailSent === true })
      return
    }
    const code = res ? await errorCode(res) : null
    setBusy(false)
    onPendingChange(false)
    setErro(code === 'reautenticar' ? 'reautenticar' : code != null && code in ERRO ? (code as keyof typeof ERRO) : 'falha')
  }

  const inputId = `eliminar-conta-handle-${user.id}`

  return (
    <Sheet open={open} onOpenChange={guarded}>
      <SheetTrigger asChild>
        <Button type="button" variant="destructive" disabled={disabled} aria-describedby={triggerDescribedBy}>
          {m.usuariosEliminarBotao}
        </Button>
      </SheetTrigger>
      <SheetContent
        side="center"
        closeLabel={m.fechar}
        showClose={!busy}
        onCloseAutoFocus={(ev) => {
          if (!succeededRef.current) return
          succeededRef.current = false
          ev.preventDefault()
        }}
        onOpenAutoFocus={(ev) => {
          ev.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <SheetHeader>
          <SheetTitle>{m.usuariosEliminarDialogoTitulo.replace('{nome}', user.name)}</SheetTitle>
          <SheetDescription>{m.usuariosEliminarDialogoDescricao}</SheetDescription>
        </SheetHeader>

        <form onSubmit={eliminar} className="flex flex-col gap-4">
          <fieldset disabled={busy} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-fg">{m.usuariosEliminarMotivoLegenda}</legend>
            {ACCOUNT_CLOSURE_REASONS.map((r) => {
              const checked = reason === r
              return (
                <label
                  key={r}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors',
                    checked ? 'border-brand bg-brand/8' : 'border-border hover:border-brand-ink',
                  )}
                >
                  <input
                    type="radio"
                    name={`motivo-${user.id}`}
                    value={r}
                    checked={checked}
                    onChange={() => {
                      setReason(r)
                      if (erro !== 'reautenticar') setErro(null)
                    }}
                    className="mt-1 accent-brand-strong"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-semibold text-fg">{m[REASON_LABEL[r]]}</span>
                    <span className="text-xs text-muted">{m[REASON_HELP[r]]}</span>
                  </span>
                </label>
              )
            })}
          </fieldset>

          {reason === 'menor_16' && (
            <div className="flex flex-col gap-0.5 rounded-md border border-border px-3 py-2.5">
              <p className="text-sm font-medium text-fg">{m.usuariosEliminarRemoverPublico}</p>
              <p className="text-xs text-muted">{m.usuariosEliminarRemoverPublicoAjuda}</p>
            </div>
          )}

          {reason === 'violacao_grave' && (
            <div className="flex items-start gap-2">
              <Checkbox
                id={`eliminar-avisar-${user.id}`}
                checked={notify}
                onCheckedChange={(v) => setNotify(v === true)}
                disabled={busy}
                aria-describedby={`eliminar-avisar-ajuda-${user.id}`}
                className="mt-0.5"
              />
              <span className="flex flex-col gap-0.5">
                <Label htmlFor={`eliminar-avisar-${user.id}`} className="font-normal leading-snug">
                  {m.usuariosEliminarAvisar}
                </Label>
                <span id={`eliminar-avisar-ajuda-${user.id}`} className="text-xs text-muted">
                  {m.usuariosEliminarAvisarAjuda}
                </span>
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={inputId} className="font-normal leading-snug">
              {m.usuariosEliminarConfirmarLabel.replace('{handle}', `@${user.handle}`)}
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(ev) => {
                setTyped(ev.target.value)
                if (erro === 'confirmacao_invalida') setErro(null)
              }}
              disabled={busy}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
            />
          </div>

          {erro === 'reautenticar' ? (
            <p ref={alertRef} role="alert" tabIndex={-1} className="text-sm font-medium text-fg">
              {m.usuariosEliminarReautenticar}{' '}
              <Link href={REAUTENTICAR_HREF} className={LINK}>
                {m.usuariosEliminarReautenticarLink}
              </Link>
            </p>
          ) : erro ? (
            <p ref={alertRef} role="alert" tabIndex={-1} className="text-sm font-medium text-fg">
              {erro === 'falha' ? m.usuariosEliminarErro : m[ERRO[erro]]}
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-3">
            <Button ref={cancelRef} type="button" variant="secondary" disabled={busy} onClick={() => guarded(false)}>
              {m.usuariosEliminarCancelar}
            </Button>
            <Button type="submit" variant="destructive" disabled={!canSubmit} aria-busy={busy}>
              {busy ? m.usuariosEliminarEliminando : m.usuariosEliminarConfirmar}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
