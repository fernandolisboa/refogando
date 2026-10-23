'use client'
/**
 * Seção "Crédito nas cópias" do `/me/profile` (#610, ADR-0052): a pessoa escolhe se as cópias que outras
 * pessoas publicam das receitas dela ("Criar minha versão" / "Clonar") mostram "Baseada na receita … de @ela".
 * Uma caixa que salva na hora (`GET/PUT /api/me/derivative-credit`); retirar o nome de UMA cópia é na página dela.
 *
 * Erro ao salvar ⇒ a caixa volta ao estado anterior e a mensagem fica na região viva. Visitante: não renderiza
 * nada (o `ProfileForm` acima já mostra o convite de entrar). ADR-0010: route handler via fetch.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useLocale } from '@/i18n/provider'
import { useSession } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'

type Status = 'loading' | 'idle' | 'saving' | 'saved' | 'error' | 'load_failed'

export function DerivativeCreditSection() {
  const { messages } = useLocale()
  const m = messages.creditoCopias
  const session = useSession()
  const authed = !session.isPending && !session.error && !!session.data

  const [creditar, setCreditar] = useState(true)
  const [status, setStatus] = useState<Status>('loading')
  const router = useRouter()
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    if (!authed) return
    const controller = new AbortController()
    void (async () => {
      try {
        const res = await fetch('/api/me/derivative-credit', { signal: controller.signal })
        if (!res.ok) {
          setStatus('load_failed')
          return
        }
        const body = (await res.json()) as { creditar?: unknown }
        if (typeof body.creditar !== 'boolean') {
          setStatus('load_failed')
          return
        }
        setCreditar(body.creditar)
        setStatus('idle')
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('load_failed')
      }
    })()
    return () => controller.abort()
  }, [authed, tentativa])

  async function alterar(novo: boolean) {
    if (status === 'saving') return
    const anterior = creditar
    setCreditar(novo)
    setStatus('saving')
    try {
      const res = await fetch('/api/me/derivative-credit', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creditar: novo }),
      })
      const body = res.ok ? ((await res.json()) as { creditar?: unknown }) : null
      if (typeof body?.creditar !== 'boolean') {
        setCreditar(anterior)
        setStatus('error')
        return
      }
      setCreditar(body.creditar)
      setStatus('saved')
      // O crédito aparece nas receitas derivadas, que ficam 5 minutos no cache do roteador (ADR-0053): limpa.
      router.refresh()
    } catch {
      setCreditar(anterior)
      setStatus('error')
    }
  }

  if (!authed) return null

  return (
    <section aria-labelledby="credito-copias-titulo" className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="credito-copias-titulo" className="font-display text-xl font-semibold tracking-tight text-fg">
          {m.perfilTitulo}
        </h2>
        <p id="credito-copias-descricao" className="text-sm text-muted">
          {m.perfilDescricao}
        </p>
      </div>

      {status === 'loading' ? (
        <div aria-busy="true" className="text-muted">
          {messages.system.loading}
        </div>
      ) : status === 'load_failed' ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm font-medium text-fg">
            {m.perfilErroCarregar}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setStatus('loading')
              setTentativa((n) => n + 1)
            }}
          >
            {messages.system.retry}
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <Checkbox
            id="credito-copias-toggle"
            checked={creditar}
            onCheckedChange={(v) => void alterar(v === true)}
            disabled={status === 'saving'}
            aria-describedby="credito-copias-descricao"
            className="mt-0.5"
          />
          <Label htmlFor="credito-copias-toggle" className="font-normal leading-snug">
            {m.perfilToggle}
          </Label>
        </div>
      )}

      {/* Região viva sempre no DOM (anuncia o desfecho do salvar). */}
      <div aria-live="polite" className="text-sm">
        {status === 'saved' && <p className="font-medium text-fg">{m.perfilSalvo}</p>}
        {status === 'error' && (
          <p role="alert" className="font-medium text-fg">
            {m.erro}
          </p>
        )}
      </div>
    </section>
  )
}
