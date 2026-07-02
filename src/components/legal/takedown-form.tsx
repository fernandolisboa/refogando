'use client'
/**
 * Formulário PÚBLICO de intake de takedown / pedido do titular (#399, GAP-2). Espelha a disciplina do
 * `ProfileForm`: consome o ROUTE HANDLER via `fetch` (nunca Server Action — ADR-0010); o servidor é a
 * fonte da verdade da validação. Aqui só há afordância de chrome — a pré-checagem client-side reusa o
 * MESMO `normalizeTakedownIntake` do domínio (evita um round-trip óbvio) e dá feedback inline.
 *
 * SEM SESSÃO: o titular B (autor externo) não tem conta. O POST é cookie-free (nunca 401). No sucesso
 * (201) o servidor abre um ticket (início do SLA de 15 dias) e grava `DSAR_RECEIVED`; a UI mostra o
 * PROTOCOLO retornado. Os códigos de erro do servidor (chaves) mapeiam para mensagens traduzidas.
 */
import { useState } from 'react'
import { useLocale } from '@/i18n/provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { fieldClassName } from '@/components/button'
import {
  TAKEDOWN_REQUEST_TYPES,
  normalizeTakedownIntake,
  type TakedownRequestType,
} from '@/domain/takedown'

type Status = 'idle' | 'sending' | 'success' | 'error'
/** Erro inline específico (chave de i18n) OU o genérico de envio. */
type FormError = 'erroPedido' | 'erroIdentificacao' | 'erroEnvio' | null

/** Rótulo i18n de cada tipo de pedido — mapa fechado sobre a allowlist do domínio (paridade no compilador). */
function requestTypeLabel(
  m: { formTipoNameRemoval: string; formTipoFullRemoval: string; formTipoOther: string },
  t: TakedownRequestType,
): string {
  switch (t) {
    case 'name_removal':
      return m.formTipoNameRemoval
    case 'full_removal':
      return m.formTipoFullRemoval
    case 'other':
      return m.formTipoOther
  }
}

export function TakedownForm() {
  const { locale, messages } = useLocale()
  const m = messages.seusDireitos

  const [requestType, setRequestType] = useState<TakedownRequestType>('name_removal')
  const [sourceUrl, setSourceUrl] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  const [contactEmail, setContactEmail] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<FormError>(null)
  const [ticketId, setTicketId] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Pré-checagem com a MESMA regra do servidor (DRY): mensagem obrigatória + ao menos um identificador.
    const parsed = normalizeTakedownIntake({ requestType, sourceUrl, displayName, message, contactEmail })
    if (!parsed.ok) {
      setError(parsed.error === 'pedido_obrigatorio' ? 'erroPedido' : 'erroIdentificacao')
      return
    }

    setStatus('sending')
    try {
      const res = await fetch(`/api/legal/takedown?locale=${encodeURIComponent(locale)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed.value),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (body.error === 'pedido_obrigatorio') setError('erroPedido')
        else if (body.error === 'identificacao_obrigatoria') setError('erroIdentificacao')
        else setError('erroEnvio')
        setStatus('error')
        return
      }
      const { ticketId: id } = (await res.json()) as { ticketId: string }
      setTicketId(id)
      setStatus('success')
    } catch {
      setError('erroEnvio')
      setStatus('error')
    }
  }

  // Estado de SUCESSO: substitui o form pelo recibo com o protocolo (número do ticket).
  if (status === 'success') {
    return (
      <div role="status" className="mt-4 rounded-md border border-border bg-surface px-4 py-4">
        <p className="font-display text-lg font-semibold text-brand-ink">{m.formSucessoTitulo}</p>
        <p className="mt-2 leading-relaxed text-fg">{m.formSucessoCorpo}</p>
        <p className="mt-3 text-sm">
          <span className="font-medium text-fg">{m.formProtocoloRotulo}:</span>{' '}
          <code className="rounded bg-brand/10 px-1.5 py-0.5 font-mono text-fg">{ticketId}</code>
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-6" noValidate>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="takedown-type" className="text-sm font-medium text-fg">
          {m.formTipoRotulo}
        </label>
        <select
          id="takedown-type"
          value={requestType}
          onChange={(e) => setRequestType(e.target.value as TakedownRequestType)}
          className={fieldClassName}
        >
          {TAKEDOWN_REQUEST_TYPES.map((t) => (
            <option key={t} value={t}>
              {requestTypeLabel(m, t)}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="takedown-url" className="text-sm font-medium text-fg">
          {m.formUrlRotulo}
        </label>
        <Input
          id="takedown-url"
          type="url"
          inputMode="url"
          value={sourceUrl}
          onChange={(e) => {
            setSourceUrl(e.target.value)
            setError(null)
          }}
          placeholder={m.formUrlPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="takedown-name" className="text-sm font-medium text-fg">
          {m.formNomeRotulo}
        </label>
        <Input
          id="takedown-name"
          type="text"
          value={displayName}
          onChange={(e) => {
            setDisplayName(e.target.value)
            setError(null)
          }}
          placeholder={m.formNomePlaceholder}
        />
        <p className="text-xs text-muted">{m.formIdentificacaoDica}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="takedown-message" className="text-sm font-medium text-fg">
          {m.formPedidoRotulo}
        </label>
        <Textarea
          id="takedown-message"
          value={message}
          onChange={(e) => {
            setMessage(e.target.value)
            setError(null)
          }}
          rows={5}
          required
          placeholder={m.formPedidoPlaceholder}
          className="resize-y"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="takedown-contact" className="text-sm font-medium text-fg">
          {m.formContatoRotulo}
        </label>
        <Input
          id="takedown-contact"
          type="email"
          inputMode="email"
          value={contactEmail}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder={m.formContatoPlaceholder}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <p className="text-xs text-muted">{m.formContatoDica}</p>
      </div>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={status === 'sending'}>
          {status === 'sending' ? m.formEnviando : m.formEnviar}
        </Button>
      </div>

      {/* Live region: erro inline (validação) ou genérico de envio. */}
      <div aria-live="polite" className="text-sm">
        {error && (
          <p role="alert" className="font-medium text-fg">
            {error === 'erroPedido' && m.erroPedido}
            {error === 'erroIdentificacao' && m.erroIdentificacao}
            {error === 'erroEnvio' && m.erroEnvio}
          </p>
        )}
      </div>
    </form>
  )
}
